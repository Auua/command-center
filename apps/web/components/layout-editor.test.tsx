import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetLayoutItem } from '@command-center/contracts';
import { DashboardGrid } from './dashboard-grid';

vi.mock('@/lib/layout-api', () => ({
  fetchLayout: vi.fn(),
  putLayout: vi.fn(),
}));
vi.mock('@/lib/appreciation-api', () => ({
  fetchAppreciations: vi.fn().mockResolvedValue({ items: [] }),
  createAppreciation: vi.fn(),
  deleteAppreciation: vi.fn(),
  fetchAppreciationPrompt: vi.fn().mockRejectedValue(new Error('no prompt in tests')),
}));
vi.mock('@/lib/braindump-api', () => ({
  fetchBraindumpNotes: vi.fn().mockResolvedValue({ items: [] }),
  createBraindumpNote: vi.fn(),
  deleteBraindumpNote: vi.fn(),
}));
vi.mock('@/lib/tasks-api', () => ({
  fetchTasks: vi.fn().mockResolvedValue({ items: [] }),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock('@/lib/mood-api', () => ({
  fetchMoodCheckins: vi.fn().mockResolvedValue({ items: [] }),
  createMoodCheckin: vi.fn(),
  deleteMoodCheckin: vi.fn(),
}));
vi.mock('@/lib/learning-api', () => ({
  fetchWotd: vi.fn().mockResolvedValue({ configured: false }),
  acknowledgeWotd: vi.fn(),
  skipWotd: vi.fn(),
  fetchGrammarToday: vi.fn().mockResolvedValue({ configured: false }),
  advanceGrammar: vi.fn(),
  studyGrammar: vi.fn(),
  fetchKanji: vi.fn().mockResolvedValue({ configured: false }),
  acknowledgeKanji: vi.fn(),
  skipKanji: vi.fn(),
  fetchAnkiStatus: vi.fn().mockResolvedValue({ configured: false }),
  fetchStreaks: vi.fn().mockResolvedValue({ timezone: 'UTC', streaks: [] }),
}));

import { fetchLayout, putLayout } from '@/lib/layout-api';
import { DEFAULT_LAYOUT } from '@/widgets/default-layout';

const fetchLayoutMock = vi.mocked(fetchLayout);
const putLayoutMock = vi.mocked(putLayout);

function placed(widgetId: string, x: number, y: number, w: number, h: number): WidgetLayoutItem {
  return { widgetId, instanceKey: '', gridPos: { x, y, w, h }, settings: {} };
}

/** A packed four-card layout: Clock, Today's tasks, Mood check-in, Braindump. */
const STORED: WidgetLayoutItem[] = [
  placed('clock', 0, 0, 2, 1),
  placed('tasks', 2, 0, 2, 2),
  placed('mood', 4, 0, 2, 2),
  { ...placed('braindump', 0, 1, 2, 2), settings: { kept: true } },
];

function renderGrid(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardGrid />
    </QueryClientProvider>,
  );
}

/** Card titles in DOM order, read from the editor bars. */
function editorOrder(): string[] {
  return screen
    .getAllByRole('group', { name: /^Arrange / })
    .map((group) => group.getAttribute('aria-label')?.replace(/^Arrange /, '') ?? '');
}

/** Card titles in DOM order outside edit mode. */
function cardOrder(): string[] {
  return screen.getAllByRole('region').map((region) => region.getAttribute('aria-label') ?? '');
}

async function enterEditMode(
  user: ReturnType<typeof userEvent.setup>,
  items: WidgetLayoutItem[] = STORED,
): Promise<void> {
  fetchLayoutMock.mockResolvedValue({ items });
  renderGrid();
  await user.click(await screen.findByRole('button', { name: 'Edit layout' }));
}

/** Every cell a placement covers, as "x,y". */
function coveredCells(items: WidgetLayoutItem[]): string[] {
  return items.flatMap((item) => {
    const out: string[] = [];
    for (let y = item.gridPos.y; y < item.gridPos.y + item.gridPos.h; y += 1) {
      for (let x = item.gridPos.x; x < item.gridPos.x + item.gridPos.w; x += 1)
        out.push(`${x},${y}`);
    }
    return out;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  putLayoutMock.mockImplementation((items) => Promise.resolve({ items }));
});

describe('layout editor', () => {
  it('enters edit mode with an editor bar per card and inert card bodies', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    expect(editorOrder()).toEqual(['Clock', "Today's tasks", 'Mood check-in', 'Braindump']);
    expect(screen.queryByRole('button', { name: 'Edit layout' })).toBeNull();
    for (const name of ['Add widget', 'Reset to default', 'Cancel', 'Done']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Focus moved from the vanished Edit button to the first toolbar button.
    expect(screen.getByRole('button', { name: 'Add widget' })).toHaveFocus();
    expect(screen.getByText(/Editing the layout/)).toBeInTheDocument();

    // The card (header buttons included) is inert while editing.
    const clock = screen.getByRole('region', { name: 'Clock' });
    expect(clock.closest('.cc-grid-item-body')).toHaveAttribute('inert');

    // Clock declares one size: no size select. The others do.
    expect(screen.queryByRole('combobox', { name: 'Size of Clock' })).toBeNull();
    expect(screen.getByRole('combobox', { name: "Size of Today's tasks" })).toBeInTheDocument();

    // First card cannot move earlier, last cannot move later.
    expect(screen.getByRole('button', { name: 'Move Clock earlier' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move Braindump later' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('moves a card later and earlier, announces it and keeps focus on the pressed button', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    const later = screen.getByRole('button', { name: 'Move Clock later' });
    await user.click(later);
    expect(editorOrder()).toEqual(["Today's tasks", 'Clock', 'Mood check-in', 'Braindump']);
    expect(screen.getByText('Clock moved to position 2 of 4.')).toBeInTheDocument();
    // Same DOM node (stable key), still focused.
    expect(screen.getByRole('button', { name: 'Move Clock later' })).toBe(later);
    expect(later).toHaveFocus();

    // Keyboard: Enter on the focused button keeps moving it.
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(editorOrder()).toEqual(["Today's tasks", 'Mood check-in', 'Braindump', 'Clock']);
    expect(later).toHaveFocus();
    expect(later).toHaveAttribute('aria-disabled', 'true');
    // Pressing it at the end changes nothing.
    await user.keyboard('{Enter}');
    expect(editorOrder()).toEqual(["Today's tasks", 'Mood check-in', 'Braindump', 'Clock']);

    const earlier = screen.getByRole('button', { name: 'Move Braindump earlier' });
    await user.click(earlier);
    expect(editorOrder()).toEqual(["Today's tasks", 'Braindump', 'Mood check-in', 'Clock']);
    expect(screen.getByText('Braindump moved to position 2 of 4.')).toBeInTheDocument();
    expect(earlier).toHaveFocus();
  });

  it('resizes a card to another declared size', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    const select = screen.getByRole('combobox', { name: "Size of Today's tasks" });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['2 × 2', '3 × 2']);
    await user.selectOptions(select, '3 × 2');
    expect(select).toHaveValue('3x2');
    expect(select).toHaveFocus();
    expect(screen.getByText("Today's tasks size 3 × 2.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const [saved] = putLayoutMock.mock.calls[0] ?? [];
    expect(saved?.find((item) => item.widgetId === 'tasks')?.gridPos).toMatchObject({ w: 3, h: 2 });
  });

  it('removes a card and moves focus to its neighbour', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Remove Mood check-in' }));
    expect(editorOrder()).toEqual(['Clock', "Today's tasks", 'Braindump']);
    expect(screen.getByText('Mood check-in removed.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Arrange Braindump' })).toHaveFocus();
  });

  it('refuses to remove the last widget', async () => {
    const user = userEvent.setup();
    await enterEditMode(user, [placed('clock', 0, 0, 2, 1)]);

    const remove = screen.getByRole('button', { name: 'Remove Clock' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAccessibleDescription(/last widget can’t be removed/);
    await user.click(remove);
    expect(editorOrder()).toEqual(['Clock']);
  });

  it('adds an unplaced widget from the picker at the end with its first size', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a widget' });
    const offered = within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(offered).toEqual(
      expect.arrayContaining(['Kanji of the day', 'Grammar point', 'Streaks']),
    );
    for (const placedTitle of ['Clock', "Today's tasks", 'Mood check-in', 'Braindump']) {
      expect(offered).not.toContain(placedTitle);
    }

    await user.click(within(dialog).getByRole('button', { name: 'Kanji of the day' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editorOrder()).toEqual([
      'Clock',
      "Today's tasks",
      'Mood check-in',
      'Braindump',
      'Kanji of the day',
    ]);
    expect(screen.getByText('Kanji of the day added at position 5 of 5.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Arrange Kanji of the day' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const [saved] = putLayoutMock.mock.calls[0] ?? [];
    expect(saved?.at(-1)).toMatchObject({
      widgetId: 'japanese-kanji',
      instanceKey: '',
      gridPos: { w: 2, h: 2 },
    });
  });

  it('says so when every widget is already placed', async () => {
    const user = userEvent.setup();
    await enterEditMode(user, DEFAULT_LAYOUT);

    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a widget' });
    expect(
      within(dialog).getByText('Every widget is already on the dashboard.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resets the draft to the default layout', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(editorOrder()).toHaveLength(DEFAULT_LAYOUT.length);
    expect(screen.getByText(/Default layout restored/)).toBeInTheDocument();
    expect(putLayoutMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(putLayoutMock).toHaveBeenCalledTimes(1);
    expect(putLayoutMock).toHaveBeenCalledWith(DEFAULT_LAYOUT);
  });

  it('Cancel restores the original layout and sends nothing', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Move Clock later' }));
    await user.click(screen.getByRole('button', { name: 'Remove Braindump' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryAllByRole('group', { name: /^Arrange / })).toHaveLength(0);
    expect(cardOrder()).toEqual(['Clock', "Today's tasks", 'Mood check-in', 'Braindump']);
    expect(putLayoutMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit layout' })).toHaveFocus();
    expect(
      screen.getByRole('region', { name: 'Clock' }).closest('.cc-grid-item-body'),
    ).not.toHaveAttribute('inert');
  });

  it('Done sends exactly one PUT with the new order and packed, non-overlapping positions', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Move Clock later' }));
    await user.click(screen.getByRole('button', { name: 'Move Clock later' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(putLayoutMock).toHaveBeenCalledTimes(1);
    const [saved = []] = putLayoutMock.mock.calls[0] ?? [];
    expect(saved.map((item) => item.widgetId)).toEqual(['tasks', 'mood', 'clock', 'braindump']);
    expect(saved.map((item) => item.gridPos)).toEqual([
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 2, y: 0, w: 2, h: 2 },
      { x: 4, y: 0, w: 2, h: 1 },
      // Fits under the 1-row clock — after it in reading order.
      { x: 4, y: 1, w: 2, h: 2 },
    ]);
    const cells = coveredCells(saved);
    expect(new Set(cells).size).toBe(cells.length);
    // Settings travel with their placement.
    expect(saved[3]?.settings).toEqual({ kept: true });

    // Edit mode left; the cache took the server's echo.
    expect(await screen.findByRole('button', { name: 'Edit layout' })).toBeInTheDocument();
    expect(cardOrder()).toEqual(["Today's tasks", 'Mood check-in', 'Clock', 'Braindump']);
    expect(screen.getByText('Layout saved.')).toBeInTheDocument();
  });

  it('Done without changes leaves edit mode without a request', async () => {
    const user = userEvent.setup();
    await enterEditMode(user);

    // A move and its reverse is no change either.
    await user.click(screen.getByRole('button', { name: 'Move Clock later' }));
    await user.click(screen.getByRole('button', { name: 'Move Clock earlier' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(putLayoutMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit layout' })).toBeInTheDocument();
  });

  it('a failed save keeps edit mode and shows the error', async () => {
    const user = userEvent.setup();
    putLayoutMock.mockRejectedValue(new Error('API down'));
    await enterEditMode(user);

    await user.click(screen.getByRole('button', { name: 'Remove Clock' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const error = await screen.findByText('Couldn’t save the layout — try again.');
    expect(error).toHaveAttribute('role', 'alert');
    expect(putLayoutMock).toHaveBeenCalledTimes(1);
    expect(editorOrder()).toEqual(["Today's tasks", 'Mood check-in', 'Braindump']);
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('opens a hand-placed layout in reading order', async () => {
    const user = userEvent.setup();
    // Stored list order differs from the (y, x) reading order.
    await enterEditMode(user, [
      placed('braindump', 0, 3, 2, 2),
      placed('mood', 4, 0, 2, 2),
      placed('clock', 0, 0, 2, 1),
    ]);

    expect(editorOrder()).toEqual(['Clock', 'Mood check-in', 'Braindump']);
  });
});
