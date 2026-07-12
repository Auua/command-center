import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoodCheckin } from "@command-center/contracts";
import type { ReactElement } from "react";
import { MoodWidget } from "./mood-widget";

vi.mock("@/lib/mood-api", () => ({
  fetchMoodCheckins: vi.fn(),
  createMoodCheckin: vi.fn(),
  deleteMoodCheckin: vi.fn(),
}));

import {
  createMoodCheckin,
  deleteMoodCheckin,
  fetchMoodCheckins,
} from "@/lib/mood-api";

const fetchMock = vi.mocked(fetchMoodCheckins);
const createMock = vi.mocked(createMoodCheckin);
const deleteMock = vi.mocked(deleteMoodCheckin);

function makeCheckin(overrides: Partial<MoodCheckin> = {}): MoodCheckin {
  return {
    id: "6f2d38a0-9a1e-4a0e-8f2a-000000000001",
    score: 4,
    tags: [],
    note: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderWidget(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <MoodWidget settings={{}} size={{ w: 2, h: 2 }} />
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ items: [] });
});

describe("MoodWidget", () => {
  it("renders the five faces and the default tag set", async () => {
    renderWidget();

    expect(
      await screen.findByText(/no check-ins yet/i),
    ).toBeInTheDocument();
    for (const label of ["Rough", "Low", "Okay", "Good", "Great"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const tag of ["focused", "energetic", "stressed", "tired"]) {
      expect(screen.getByRole("button", { name: tag })).toBeInTheDocument();
    }
  });

  it("logs a check-in when a face is tapped, including toggled tags", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue(makeCheckin({ score: 4, tags: ["focused"] }));
    renderWidget();
    await screen.findByText(/no check-ins yet/i);

    await user.click(screen.getByRole("button", { name: "focused" }));
    await user.click(screen.getByRole("button", { name: "Good" }));

    // mutationFn receives (variables, context) in TanStack Query v5 — only
    // the variables matter here.
    await waitFor(() =>
      expect(createMock.mock.calls[0]?.[0]).toEqual({
        score: 4,
        tags: ["focused"],
        note: null,
      }),
    );
    expect(await screen.findByText(/logged good/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("undoes the just-logged check-in", async () => {
    const user = userEvent.setup();
    const logged = makeCheckin({ score: 2 });
    createMock.mockResolvedValue(logged);
    deleteMock.mockResolvedValue(undefined);
    renderWidget();
    await screen.findByText(/no check-ins yet/i);

    await user.click(screen.getByRole("button", { name: "Low" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(deleteMock.mock.calls[0]?.[0]).toBe(logged.id));
    await waitFor(() =>
      expect(screen.queryByText(/logged low/i)).not.toBeInTheDocument(),
    );
  });

  it("shows today's latest check-in as pressed and the trend value", async () => {
    fetchMock.mockResolvedValue({
      items: [makeCheckin({ score: 5, createdAt: new Date().toISOString() })],
    });
    renderWidget();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Great" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText("Great · 5/5")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /mood scores for the last 7 days/i }),
    ).toBeInTheDocument();
  });

  it("shows an error state when logging fails", async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValue(new Error("api down"));
    renderWidget();
    await screen.findByText(/no check-ins yet/i);

    await user.click(screen.getByRole("button", { name: "Okay" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t save that check-in/i,
    );
  });

  it("shows an error state when loading fails", async () => {
    fetchMock.mockRejectedValue(new Error("api down"));
    renderWidget();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t load mood check-ins/i,
    );
  });
});
