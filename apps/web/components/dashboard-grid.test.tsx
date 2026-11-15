import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardGrid } from './dashboard-grid';

vi.mock('@/lib/layout-api', () => ({
  fetchLayout: vi.fn(),
  putLayout: vi.fn(),
}));
vi.mock('@/lib/braindump-api', () => ({
  fetchBraindumpNotes: vi.fn(),
  createBraindumpNote: vi.fn(),
  deleteBraindumpNote: vi.fn(),
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
vi.mock('@/lib/mood-api', () => ({
  fetchMoodCheckins: vi.fn(),
  createMoodCheckin: vi.fn(),
  deleteMoodCheckin: vi.fn(),
}));

import { fetchBraindumpNotes } from '@/lib/braindump-api';
import { fetchLayout, putLayout } from '@/lib/layout-api';
import { fetchMoodCheckins } from '@/lib/mood-api';

const fetchLayoutMock = vi.mocked(fetchLayout);
const putLayoutMock = vi.mocked(putLayout);
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

describe('DashboardGrid', () => {
  it('falls back to the default layout when the API is unreachable', async () => {
    fetchLayoutMock.mockRejectedValue(new Error('API down'));

    renderGrid();

    // Default layout contains the phase-1 widgets.
    expect(await screen.findByRole('region', { name: 'Clock' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Braindump' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mood check-in' })).toBeInTheDocument();
  });

  it('renders the persisted layout when the API responds', async () => {
    fetchLayoutMock.mockResolvedValue({
      items: [
        { widgetId: 'clock', instanceKey: '', gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
      ],
    });

    renderGrid();

    expect(await screen.findByRole('region', { name: 'Clock' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Braindump' })).toBeNull();
  });

  it('shows a fallback card for unknown widget ids', async () => {
    fetchLayoutMock.mockResolvedValue({
      items: [
        {
          widgetId: 'not-built-yet',
          instanceKey: '',
          gridPos: { x: 0, y: 0, w: 2, h: 1 },
          settings: {},
        },
      ],
    });

    renderGrid();

    expect(await screen.findByText(/unknown widget/i)).toBeInTheDocument();
  });

  it('shows a settings button only for widgets whose schema has fields', async () => {
    fetchLayoutMock.mockResolvedValue({
      items: [
        { widgetId: 'clock', instanceKey: '', gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
        {
          widgetId: 'braindump',
          instanceKey: '',
          gridPos: { x: 2, y: 0, w: 2, h: 2 },
          settings: {},
        },
      ],
    });

    renderGrid();

    const clock = await screen.findByRole('region', { name: 'Clock' });
    expect(within(clock).getByRole('button', { name: 'Settings for Clock' })).toBeInTheDocument();
    const braindump = screen.getByRole('region', { name: 'Braindump' });
    expect(within(braindump).queryByRole('button', { name: /settings/i })).toBeNull();
  });

  it('saves a changed setting by writing the whole layout back', async () => {
    const user = userEvent.setup();
    const items = [
      { widgetId: 'clock', instanceKey: '', gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
      {
        widgetId: 'braindump',
        instanceKey: '',
        gridPos: { x: 2, y: 0, w: 2, h: 2 },
        settings: {},
      },
    ];
    fetchLayoutMock.mockResolvedValue({ items });
    putLayoutMock.mockImplementation((next) => Promise.resolve({ items: next }));

    renderGrid();

    const clock = await screen.findByRole('region', { name: 'Clock' });
    await user.click(within(clock).getByRole('button', { name: 'Settings for Clock' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clock settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: '12-hour clock' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(putLayoutMock).toHaveBeenCalledWith([
      { ...items[0], settings: { hour12: true } },
      items[1],
    ]);
  });

  it('uses the default layout when the persisted layout is empty', async () => {
    fetchLayoutMock.mockResolvedValue({ items: [] });

    renderGrid();

    expect(await screen.findByRole('region', { name: 'Braindump' })).toBeInTheDocument();
  });
});

describe('DashboardGrid columns (ADR-042: columns follow the width)', () => {
  /** A ResizeObserver that reports one fixed width — jsdom has no layout engine. */
  function stubResizeObserver(width: number): void {
    class FixedWidthObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FixedWidthObserver);
  }

  function cellOf(name: string): HTMLElement {
    const cell = screen.getByRole('region', { name }).closest<HTMLElement>('.cc-grid-item');
    if (!cell) throw new Error(`no grid cell for ${name}`);
    return cell;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays at six columns when the width cannot be measured', async () => {
    fetchLayoutMock.mockRejectedValue(new Error('API down'));
    renderGrid();
    await screen.findByRole('region', { name: 'Clock' });
    const grid = cellOf('Clock').parentElement as HTMLElement;
    expect(grid.dataset.columns).toBe('6');
    expect(grid.style.getPropertyValue('--cc-columns')).toBe('6');
  });

  it('adds columns on a wide screen and packs more cards into the first row', async () => {
    // No CSS in jsdom, so the gap reads as 0: 1600 px / 160 px = 10 columns.
    stubResizeObserver(1600);
    fetchLayoutMock.mockRejectedValue(new Error('API down'));
    renderGrid();
    await screen.findByRole('region', { name: 'Clock' });

    const grid = cellOf('Clock').parentElement as HTMLElement;
    expect(grid.dataset.columns).toBe('10');
    // Default order clock, braindump, mood, tasks: at six columns tasks starts
    // the second row; at ten it is the fourth card of the first row.
    expect(cellOf("Today's tasks").style.getPropertyValue('--cc-col')).toBe('7 / span 2');
    expect(cellOf("Today's tasks").style.getPropertyValue('--cc-row')).toBe('1 / span 2');
  });

  it('re-flows a hand-placed stored layout by its reading order', async () => {
    stubResizeObserver(1600);
    fetchLayoutMock.mockResolvedValue({
      items: [
        // Stored out of order and with a gap; rendered in reading order, packed.
        { widgetId: 'mood', instanceKey: '', gridPos: { x: 4, y: 3, w: 2, h: 2 }, settings: {} },
        { widgetId: 'clock', instanceKey: '', gridPos: { x: 0, y: 0, w: 2, h: 1 }, settings: {} },
      ],
    });
    renderGrid();
    await screen.findByRole('region', { name: 'Clock' });
    expect(cellOf('Clock').style.getPropertyValue('--cc-col')).toBe('1 / span 2');
    expect(cellOf('Mood check-in').style.getPropertyValue('--cc-col')).toBe('3 / span 2');
    expect(cellOf('Mood check-in').style.getPropertyValue('--cc-row')).toBe('1 / span 2');
  });

  it('saves at the reference width whatever the screen shows', async () => {
    const user = userEvent.setup();
    stubResizeObserver(1600);
    fetchLayoutMock.mockRejectedValue(new Error('API down'));
    putLayoutMock.mockImplementation((next) => Promise.resolve({ items: next }));
    renderGrid();
    await screen.findByRole('region', { name: 'Clock' });

    await user.click(screen.getByRole('button', { name: 'Edit layout' }));
    await user.click(screen.getByRole('button', { name: 'Move Clock later' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(putLayoutMock).toHaveBeenCalledTimes(1);
    const saved = putLayoutMock.mock.calls[0]?.[0] ?? [];
    expect(saved.map((item) => item.widgetId).slice(0, 2)).toEqual(['braindump', 'clock']);
    for (const item of saved) {
      expect(item.gridPos.x + item.gridPos.w).toBeLessThanOrEqual(6);
    }
  });
});
