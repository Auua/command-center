import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGrid } from "./dashboard-grid";

vi.mock("@/lib/layout-api", () => ({
  fetchLayout: vi.fn(),
}));
vi.mock("@/lib/braindump-api", () => ({
  fetchBraindumpNotes: vi.fn(),
  createBraindumpNote: vi.fn(),
  deleteBraindumpNote: vi.fn(),
}));
vi.mock("@/lib/mood-api", () => ({
  fetchMoodCheckins: vi.fn(),
  createMoodCheckin: vi.fn(),
  deleteMoodCheckin: vi.fn(),
}));

import { fetchBraindumpNotes } from "@/lib/braindump-api";
import { fetchLayout } from "@/lib/layout-api";
import { fetchMoodCheckins } from "@/lib/mood-api";

const fetchLayoutMock = vi.mocked(fetchLayout);
const fetchNotesMock = vi.mocked(fetchBraindumpNotes);
const fetchMoodMock = vi.mocked(fetchMoodCheckins);

function renderGrid(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardGrid />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchNotesMock.mockResolvedValue({ items: [] });
  fetchMoodMock.mockResolvedValue({ items: [] });
});

describe("DashboardGrid", () => {
  it("falls back to the default layout when the API is unreachable", async () => {
    fetchLayoutMock.mockRejectedValue(new Error("API down"));

    renderGrid();

    // Default layout contains the phase-1 widgets.
    expect(
      await screen.findByRole("region", { name: "Clock" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Braindump" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Mood check-in" }),
    ).toBeInTheDocument();
  });

  it("renders the persisted layout when the API responds", async () => {
    fetchLayoutMock.mockResolvedValue({
      items: [
        { widgetId: "clock", gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
      ],
    });

    renderGrid();

    expect(
      await screen.findByRole("region", { name: "Clock" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Braindump" })).toBeNull();
  });

  it("shows a fallback card for unknown widget ids", async () => {
    fetchLayoutMock.mockResolvedValue({
      items: [
        {
          widgetId: "not-built-yet",
          gridPos: { x: 0, y: 0, w: 2, h: 1 },
          settings: {},
        },
      ],
    });

    renderGrid();

    expect(await screen.findByText(/unknown widget/i)).toBeInTheDocument();
  });

  it("uses the default layout when the persisted layout is empty", async () => {
    fetchLayoutMock.mockResolvedValue({ items: [] });

    renderGrid();

    expect(
      await screen.findByRole("region", { name: "Braindump" }),
    ).toBeInTheDocument();
  });
});
