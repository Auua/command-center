import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarOccurrence } from '@command-center/contracts';
import { CalendarScreen, nextRoundHour } from './calendar-screen';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: (): { push: typeof push } => ({ push }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/profile-api', () => ({
  fetchProfile: vi.fn().mockResolvedValue({ timezone: 'Europe/Helsinki' }),
}));
vi.mock('@/lib/layout-api', () => ({
  fetchLayout: vi.fn().mockResolvedValue({
    items: [
      {
        widgetId: 'calendar',
        instanceKey: '',
        gridPos: { x: 0, y: 0, w: 4, h: 2 },
        settings: { showTaskDeadlines: false },
      },
    ],
  }),
}));
vi.mock('@/lib/tasks-api', () => ({ fetchTasks: vi.fn() }));
vi.mock('@/lib/calendar-api', () => ({
  calendarRangeKey: (from: string, to: string): string[] => ['calendar', from, to],
  fetchCalendarRange: vi.fn(),
  fetchCalendarEvent: vi.fn(),
}));

import { fetchCalendarRange } from '@/lib/calendar-api';
import { fetchTasks } from '@/lib/tasks-api';

const dinner: CalendarOccurrence = {
  seriesId: '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e',
  occurrenceStart: '2026-11-24T16:00:00.000Z',
  isRecurring: false,
  title: 'Dinner',
  location: null,
  note: null,
  allDay: false,
  startsAt: '2026-11-24T16:00:00.000Z',
  endsAt: '2026-11-24T18:00:00.000Z',
};

function renderScreen(props: Parameters<typeof CalendarScreen>[0] = {}): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalendarScreen {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
  vi.mocked(fetchCalendarRange).mockImplementation(async (from, to) => ({
    timeZone: 'Europe/Helsinki',
    from,
    to,
    occurrences: [dinner],
  }));
});

afterEach(() => vi.useRealTimers());

describe('CalendarScreen', () => {
  it('lands on the agenda for the next 30 days and pages through history', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();
    expect(await screen.findByRole('button', { name: /18:00–20:00 Dinner/ })).toBeVisible();
    expect(fetchCalendarRange).toHaveBeenCalledWith('2026-11-20', '2026-12-20');
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true');
    // The card's setting turns the task overlay off: no tasks request.
    expect(fetchTasks).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Later/ }));
    expect(push).toHaveBeenCalledWith('/calendar?view=agenda&date=2026-12-20', { scroll: false });
    await user.click(screen.getByRole('button', { name: 'Month' }));
    expect(push).toHaveBeenLastCalledWith('/calendar?view=month&date=2026-11-20', {
      scroll: false,
    });
  });

  it('shows the month grid for the URL’s date, and a day’s events on Enter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen({ view: 'month', date: '2026-11-20' });
    const grid = await screen.findByRole('grid', { name: 'November 2026' });
    // Monday-first weeks: 26 Oct – 6 Dec.
    expect(fetchCalendarRange).toHaveBeenCalledWith('2026-10-26', '2026-12-07');

    const tuesday = await within(grid).findByRole('gridcell', {
      name: 'Tuesday 24 November, 1 event',
    });
    fireEvent.keyDown(tuesday, { key: 'Enter' });
    const panel = await screen.findByRole('region', { name: 'Tuesday 24 November' });
    expect(panel).toHaveFocus();
    expect(within(panel).getByRole('button', { name: /Dinner/ })).toBeVisible();

    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Tuesday 24 November' })).toBeNull();
    expect(within(grid).getByRole('gridcell', { name: /^Friday 20 November/ })).toHaveFocus();
  });

  it('moves to the next month in the URL when focus crosses into it', async () => {
    renderScreen({ view: 'month', date: '2026-11-30' });
    const grid = await screen.findByRole('grid', { name: 'November 2026' });
    const last = within(grid).getByRole('gridcell', { name: /^Monday 30 November/ });
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(push).toHaveBeenCalledWith('/calendar?view=month&date=2026-12-01', { scroll: false });
  });
});

describe('nextRoundHour', () => {
  it('is the next whole hour in the home zone, never past 23:00', () => {
    expect(nextRoundHour('Europe/Helsinki', new Date('2026-11-20T10:20:00.000Z'))).toEqual({
      date: '2026-11-20',
      time: '13:00',
    });
    expect(nextRoundHour('Europe/Helsinki', new Date('2026-11-20T21:40:00.000Z'))).toEqual({
      date: '2026-11-20',
      time: '23:00',
    });
  });
});
