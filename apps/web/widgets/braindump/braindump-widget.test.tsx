import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BraindumpNote } from "@command-center/contracts";
import { BraindumpWidget } from "./braindump-widget";

vi.mock("@/lib/braindump-api", () => ({
  fetchBraindumpNotes: vi.fn(),
  createBraindumpNote: vi.fn(),
  deleteBraindumpNote: vi.fn(),
}));

import {
  createBraindumpNote,
  deleteBraindumpNote,
  fetchBraindumpNotes,
} from "@/lib/braindump-api";

const fetchMock = vi.mocked(fetchBraindumpNotes);
const createMock = vi.mocked(createBraindumpNote);
const deleteMock = vi.mocked(deleteBraindumpNote);

function note(overrides: Partial<BraindumpNote> = {}): BraindumpNote {
  return {
    id: "665f1e1e1e1e1e1e1e1e1e1e",
    content: "an old thought",
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:00.000Z",
    ...overrides,
  };
}

function renderWithQuery(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BraindumpWidget", () => {
  it("renders the user's notes", async () => {
    fetchMock.mockResolvedValue({ items: [note()] });

    renderWithQuery(<BraindumpWidget />);

    expect(await screen.findByText("an old thought")).toBeInTheDocument();
  });

  it("shows an empty state when there are no notes", async () => {
    fetchMock.mockResolvedValue({ items: [] });

    renderWithQuery(<BraindumpWidget />);

    expect(
      await screen.findByText(/dump your first thought/i),
    ).toBeInTheDocument();
  });

  it("shows an error state when loading fails (widget failure posture)", async () => {
    fetchMock.mockRejectedValue(new Error("API down"));

    renderWithQuery(<BraindumpWidget />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t load braindump/i,
    );
  });

  it("creates a note on Enter and clears the textarea", async () => {
    fetchMock.mockResolvedValue({ items: [] });
    createMock.mockResolvedValue(note({ content: "new idea" }));
    const user = userEvent.setup();

    renderWithQuery(<BraindumpWidget />);
    const input = await screen.findByLabelText(/dump a thought/i);
    await user.type(input, "new idea{Enter}");

    // TanStack Query passes a context object as the mutationFn's 2nd arg.
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith("new idea", expect.anything()),
    );
    expect(input).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of submitting", async () => {
    fetchMock.mockResolvedValue({ items: [] });
    const user = userEvent.setup();

    renderWithQuery(<BraindumpWidget />);
    const input = await screen.findByLabelText(/dump a thought/i);
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");

    expect(createMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");
  });

  it("does not submit whitespace-only drafts", async () => {
    fetchMock.mockResolvedValue({ items: [] });
    const user = userEvent.setup();

    renderWithQuery(<BraindumpWidget />);
    const input = await screen.findByLabelText(/dump a thought/i);
    await user.type(input, "   {Enter}");

    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("deletes a note via its delete button", async () => {
    fetchMock.mockResolvedValue({ items: [note()] });
    deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithQuery(<BraindumpWidget />);
    await user.click(
      await screen.findByRole("button", { name: /delete note/i }),
    );

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        "665f1e1e1e1e1e1e1e1e1e1e",
        expect.anything(),
      ),
    );
  });

  it("surfaces a save error without losing the list", async () => {
    fetchMock.mockResolvedValue({ items: [note()] });
    createMock.mockRejectedValue(new Error("500"));
    const user = userEvent.setup();

    renderWithQuery(<BraindumpWidget />);
    const input = await screen.findByLabelText(/dump a thought/i);
    await user.type(input, "doomed{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t save/i,
    );
    expect(screen.getByText("an old thought")).toBeInTheDocument();
  });
});
