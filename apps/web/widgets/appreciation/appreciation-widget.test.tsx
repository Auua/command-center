import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppreciationEntry } from '@command-center/contracts';
import { createQuickActionBus, QuickActionProvider, type QuickActionBus } from '@command-center/ui';
import { AppreciationWidget, type AppreciationSettings, UNDO_MS } from './appreciation-widget';

vi.mock('@/lib/appreciation-api', () => ({
  fetchAppreciations: vi.fn(),
  createAppreciation: vi.fn(),
  deleteAppreciation: vi.fn(),
  fetchAppreciationPrompt: vi.fn(),
}));

import {
  createAppreciation,
  deleteAppreciation,
  fetchAppreciationPrompt,
  fetchAppreciations,
} from '@/lib/appreciation-api';

const listMock = vi.mocked(fetchAppreciations);
const createMock = vi.mocked(createAppreciation);
const deleteMock = vi.mocked(deleteAppreciation);
const promptMock = vi.mocked(fetchAppreciationPrompt);

const PROMPT = 'What made you smile today?';
const DAY_MS = 86_400_000;

let counter = 0;
function entry(text: string, ageMs = DAY_MS * 2): AppreciationEntry {
  counter += 1;
  return {
    id: `6f2d38a0-9a1e-4a0e-8f2a-${String(counter).padStart(12, '0')}`,
    text,
    tags: [],
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  };
}

function renderWidget(settings: AppreciationSettings = {}): {
  bus: QuickActionBus;
} & ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const bus = createQuickActionBus();
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <QuickActionProvider value={bus}>
        <AppreciationWidget settings={settings} size={{ w: 2, h: 2 }} />
      </QuickActionProvider>
    </QueryClientProvider>
  );
  return { bus, ...render(ui) };
}

const input = (): HTMLInputElement => screen.getByLabelText('Add an appreciation');

/**
 * A tiny in-memory server for the write tests, so a refetch after a delete or
 * an undo sees what the real API would.
 */
function fakeServer(initial: AppreciationEntry[]): { items: () => AppreciationEntry[] } {
  let rows = [...initial];
  listMock.mockImplementation(async () => ({ items: [...rows] }));
  deleteMock.mockImplementation(async (id) => {
    rows = rows.filter((row) => row.id !== id);
  });
  createMock.mockImplementation(async (request) => {
    const created = { ...entry(request.text, 0), tags: request.tags ?? [] };
    rows = [created, ...rows];
    return created;
  });
  return { items: () => rows };
}

beforeEach(() => {
  vi.clearAllMocks();
  promptMock.mockResolvedValue({ id: 'smile', text: PROMPT, date: '2026-11-15' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AppreciationWidget', () => {
  it('shows the most recent entries and reveals the rest with "Show more"', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      items: ['one', 'two', 'three', 'four', 'five'].map((text) => entry(text)),
    });
    renderWidget({ recentCount: 3 });

    expect(await screen.findByText('one')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('four')).toBeNull();

    const more = screen.getByRole('button', { name: 'Show 2 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('uses the day’s prompt as the placeholder until the first entry of the day', async () => {
    listMock.mockResolvedValue({ items: [entry('yesterday’s thing')] });
    renderWidget();

    await waitFor(() => expect(input()).toHaveAttribute('placeholder', PROMPT));
    // The prompt is described, never the only label.
    expect(input()).toHaveAccessibleDescription(`Today’s prompt: ${PROMPT}`);
  });

  it('reverts to the neutral placeholder once there is an entry today', async () => {
    listMock.mockResolvedValue({ items: [entry('this morning', 60_000)] });
    renderWidget();
    await screen.findByText('this morning');
    await waitFor(() => expect(promptMock).toHaveBeenCalled());
    expect(input()).toHaveAttribute('placeholder', 'One small good thing…');
  });

  it('keeps the neutral placeholder when the prompt cannot be read, or is switched off', async () => {
    listMock.mockResolvedValue({ items: [] });
    promptMock.mockRejectedValue(new Error('down'));
    renderWidget();
    await waitFor(() => expect(promptMock).toHaveBeenCalled());
    expect(input()).toHaveAttribute('placeholder', 'One small good thing…');
  });

  it('does not ask for a prompt when the setting is off', async () => {
    listMock.mockResolvedValue({ items: [] });
    renderWidget({ showDailyPrompt: false });
    await screen.findByText(/one small thing that went right/);
    expect(promptMock).not.toHaveBeenCalled();
    expect(input()).toHaveAttribute('placeholder', 'One small good thing…');
  });

  it('adds optimistically: the input clears and the entry shows before the save returns', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ items: [entry('older')] });
    let finish: (value: AppreciationEntry) => void = () => {};
    createMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWidget();
    await screen.findByText('older');

    await user.type(input(), 'Sun on the balcony{Enter}');

    expect(input()).toHaveValue('');
    expect(screen.getByText('Sun on the balcony')).toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(createMock).toHaveBeenCalledWith({ text: 'Sun on the balcony' });

    await act(async () => finish(entry('Sun on the balcony', 0)));
    expect(await screen.findByText('Appreciation added.')).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).toBeNull();
  });

  it('rolls a failed add back and puts the text back into the input', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ items: [] });
    createMock.mockRejectedValue(new Error('down'));
    renderWidget();
    await screen.findByText(/one small thing/);

    await user.type(input(), 'Never lost{Enter}');

    await waitFor(() => expect(input()).toHaveValue('Never lost'));
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getAllByText(/your text is back in the box/).length).toBeGreaterThan(0);
  });

  it('deletes with a focused Undo that brings the entry back by re-posting it', async () => {
    const user = userEvent.setup();
    const target = entry('The dog said hi');
    const server = fakeServer([target, entry('second')]);
    renderWidget();
    await screen.findByText('The dog said hi');

    await user.click(screen.getByRole('button', { name: 'Delete: The dog said hi' }));

    expect(screen.queryByText('The dog said hi')).toBeNull();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();
    expect(screen.getByText('Entry deleted. Undo available.')).toBeInTheDocument();
    expect(deleteMock).toHaveBeenCalledWith(target.id);

    await user.click(undo);

    expect(createMock).toHaveBeenCalledWith({ text: 'The dog said hi', tags: [] });
    expect(await screen.findByText('The dog said hi')).toBeInTheDocument();
    // Re-posted as a new row: the original id is gone for good.
    expect(server.items().map((row) => row.text)).toEqual(['The dog said hi', 'second']);
    expect(server.items()[0]?.id).not.toBe(target.id);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    // Focus never drops to <body>.
    expect(input()).toHaveFocus();
  });

  it('keeps Undo while it has focus and lets it expire after focus leaves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    fakeServer([entry('first'), entry('second')]);
    renderWidget();
    await screen.findByText('first');

    await user.click(screen.getByRole('button', { name: 'Delete: first' }));
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();

    // Paused while focused: well past the timeout, still there.
    act(() => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    // Focus moves away: the timeout runs.
    act(() => {
      input().focus();
    });
    act(() => {
      vi.advanceTimersByTime(UNDO_MS + 10);
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('moves focus to the next entry when Undo is dismissed', async () => {
    const user = userEvent.setup();
    fakeServer([entry('first'), entry('second')]);
    renderWidget();
    await screen.findByText('first');

    await user.click(screen.getByRole('button', { name: 'Delete: first' }));
    await screen.findByText('Entry deleted.');
    await user.click(screen.getByRole('button', { name: 'Dismiss undo' }));

    expect(screen.getByRole('button', { name: 'Delete: second' })).toHaveFocus();
  });

  it('puts a failed delete back into the list', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({ items: [entry('stays')] });
    deleteMock.mockRejectedValue(new Error('down'));
    renderWidget();
    await screen.findByText('stays');

    await user.click(screen.getByRole('button', { name: 'Delete: stays' }));

    expect(await screen.findByText('stays')).toBeInTheDocument();
    expect(screen.getAllByText(/it’s back in the list/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('says "All clear" after the last entry is deleted, not the first-use copy', async () => {
    const user = userEvent.setup();
    fakeServer([entry('only one')]);
    renderWidget();
    await screen.findByText('only one');

    await user.click(screen.getByRole('button', { name: 'Delete: only one' }));

    expect(await screen.findByText(/All clear/)).toBeInTheDocument();
    expect(screen.queryByText(/one small thing that went right/)).toBeNull();
  });

  it('focuses the input on the "Add appreciation" quick action', async () => {
    listMock.mockResolvedValue({ items: [] });
    const { bus } = renderWidget();
    await screen.findByText(/one small thing/);

    act(() => bus.dispatch('add-appreciation'));

    expect(input()).toHaveFocus();
  });

  it('shows a retry when the list cannot be loaded', async () => {
    listMock.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ items: [entry('back')] });
    renderWidget();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText('Couldn’t load appreciations.')).toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText('back')).toBeInTheDocument();
    // The input stays usable while the list is down.
    expect(within(document.body).getByLabelText('Add an appreciation')).toBeEnabled();
  });
});
