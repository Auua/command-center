import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarOccurrence } from '@command-center/contracts';
import { createQuickActionBus, QuickActionProvider } from '@command-center/ui';
import { CalendarWidget } from './calendar-widget';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/profile-api', () => ({
  fetchProfile: vi.fn().mockResolvedValue({ timezone: 'Europe/Helsinki' }),
}));
vi.mock('@/lib/tasks-api', () => ({ fetchTasks: vi.fn() }));
vi.mock('@/lib/calendar-api', () => ({
  calendarRangeKey: (from: string, to: string): string[] => ['calendar', from, to],
  fetchCalendarRange: vi.fn(),
  fetchCalendarEvent: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  deleteCalendarOccurrence: vi.fn(),
}));

import {
  createCalendarEvent,
  deleteCalendarOccurrence,
  fetchCalendarEvent,
  fetchCalendarRange,
} from '@/lib/calendar-api';
import { fetchTasks } from '@/lib/tasks-api';

const SERIES = '7d3c0a8e-5a8a-4c1b-9d3e-1f2a3b4c5d6e';
const swim = (date: string, startsAt: string, endsAt: string): CalendarOccurrence => ({
  seriesId: SERIES,
  occurrenceStart: startsAt,
  isRecurring: true,
  title: 'Swim',
  location: 'Yrjönkatu',
  note: null,
  allDay: false,
  startsAt,
  endsAt,
});
const TODAY_SWIM = swim('2026-11-20', '2026-11-20T16:00:00.000Z', '2026-11-20T17:00:00.000Z');
const NEXT_SWIM = swim('2026-11-27', '2026-11-27T16:00:00.000Z', '2026-11-27T17:00:00.000Z');
const SERIES_EVENT: CalendarEvent = {
  id: SERIES,
  title: 'Swim',
  location: 'Yrjönkatu',
  note: null,
  rrule: 'FREQ=WEEKLY;BYDAY=FR',
  exdates: [],
  timeZone: 'Europe/Helsinki',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  allDay: false,
  startsAt: '2026-11-06T16:00:00.000Z',
  endsAt: '2026-11-06T17:00:00.000Z',
};

function renderWidget(w = 4): ReturnType<typeof createQuickActionBus> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bus = createQuickActionBus();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <QuickActionProvider value={bus}>
        <CalendarWidget settings={{}} size={{ w, h: 2 }} />
      </QuickActionProvider>
    </QueryClientProvider>
  );
  render(ui);
  return bus;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Friday 20 Nov 2026, 12:00 in Helsinki.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
  vi.mocked(fetchCalendarRange).mockResolvedValue({
    timeZone: 'Europe/Helsinki',
    from: '2026-11-20',
    to: '2026-11-28',
    occurrences: [TODAY_SWIM, NEXT_SWIM],
  });
  vi.mocked(fetchCalendarEvent).mockResolvedValue(SERIES_EVENT);
  vi.mocked(fetchTasks).mockResolvedValue({
    items: [
      {
        id: 't1',
        title: 'Pay rent',
        priority: null,
        tags: [],
        deadline: '2026-11-23',
        completedAt: null,
        createdAt: '2026-11-01T10:00:00.000Z',
      } as never,
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CalendarWidget', () => {
  it('lists the rolling week at 4×2, with task deadlines as markers', async () => {
    renderWidget(4);
    expect(
      await screen.findByRole('heading', { name: /^Today · Friday 20 November/ }),
    ).toBeVisible();
    expect(fetchCalendarRange).toHaveBeenCalledWith('2026-11-20', '2026-11-28');
    // Time, title, "Repeats", place — jsdom puts a space before the inline ", Repeats".
    expect(
      screen.getAllByRole('button', { name: /^18:00–19:00 Swim ?, Repeats Yrjönkatu$/ }),
    ).toHaveLength(2);
    expect(await screen.findByText('Pay rent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });

  it('shows only today at 2×2', async () => {
    renderWidget(2);
    await screen.findByRole('heading', { name: /^Today/ });
    expect(screen.getAllByRole('button', { name: /Swim/ })).toHaveLength(1);
    expect(screen.queryByText('Pay rent')).toBeNull();
  });

  it('offers a new event when nothing is scheduled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(fetchCalendarRange).mockResolvedValue({
      timeZone: 'Europe/Helsinki',
      from: '2026-11-20',
      to: '2026-11-28',
      occurrences: [],
    });
    renderWidget(2);
    expect(await screen.findByText('Nothing scheduled — enjoy the quiet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New event' }));
    expect(await screen.findByRole('dialog', { name: 'New event' })).toBeInTheDocument();
  });

  it('creates a weekly event from the quick action, in the home timezone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(createCalendarEvent).mockResolvedValue(SERIES_EVENT);
    const bus = renderWidget();
    await screen.findByRole('heading', { name: /^Today/ });

    act(() => bus.dispatch('new-event'));
    const dialog = await screen.findByRole('dialog', { name: 'New event' });
    const title = within(dialog).getByLabelText('Title');
    expect(title).toHaveFocus();
    // The next whole hour, an hour long.
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('13:00');
    expect(within(dialog).getByLabelText('End time')).toHaveValue('14:00');

    await user.type(title, 'Choir');
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'weekly');
    expect(within(dialog).getByRole('checkbox', { name: 'Friday' })).toBeChecked();
    expect(within(dialog).getByText('Every week on Fri', { selector: 'p' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create event' }));

    await waitFor(() =>
      expect(createCalendarEvent).toHaveBeenCalledWith({
        allDay: false,
        title: 'Choir',
        startsAt: '2026-11-20T11:00:00.000Z',
        endsAt: '2026-11-20T12:00:00.000Z',
        rrule: 'FREQ=WEEKLY;BYDAY=FR',
        location: null,
        note: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses an end before the start, without saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bus = renderWidget();
    await screen.findByRole('heading', { name: /^Today/ });
    act(() => bus.dispatch('new-event'));
    const dialog = await screen.findByRole('dialog', { name: 'New event' });
    await user.type(within(dialog).getByLabelText('Title'), 'Oops');
    fireEvent.change(within(dialog).getByLabelText('End time'), { target: { value: '12:00' } });
    await user.click(within(dialog).getByRole('button', { name: 'Create event' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The end has to be after the start.',
    );
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('deletes one occurrence behind Undo, sending it when the window closes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(deleteCalendarOccurrence).mockResolvedValue();
    renderWidget();
    const [first] = await screen.findAllByRole('button', { name: /Swim/ });
    await user.click(first as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    expect(await within(dialog).findByLabelText('Title')).toHaveValue('Swim');
    expect(within(dialog).getByText('Every week on Fri', { selector: 'p' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await user.click(within(dialog).getByRole('button', { name: 'Only this one' }));

    await waitFor(() => expect(screen.getAllByRole('button', { name: /Swim/ })).toHaveLength(1));
    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toHaveFocus());
    expect(deleteCalendarOccurrence).not.toHaveBeenCalled();

    // Focus is on Undo, which pauses the countdown; leaving it resumes.
    act(() => undo.blur());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(deleteCalendarOccurrence).toHaveBeenCalledWith(SERIES, TODAY_SWIM.occurrenceStart);
  });

  it('brings the occurrence back on Undo and sends nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWidget();
    const [first] = await screen.findAllByRole('button', { name: /Swim/ });
    await user.click(first as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    await within(dialog).findByLabelText('Title');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await user.click(within(dialog).getByRole('button', { name: 'The whole series' }));
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /Swim/ })).toHaveLength(0));

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getAllByRole('button', { name: /Swim/ })).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(deleteCalendarOccurrence).not.toHaveBeenCalled();
  });
});
