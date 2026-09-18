import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreaksResponse } from '@command-center/contracts';
import { StreaksWidget, streakName, type StreaksSettings } from './streaks-widget';

vi.mock('@/lib/learning-api', () => ({
  fetchStreaks: vi.fn(),
}));

import { fetchStreaks } from '@/lib/learning-api';

const fetchMock = vi.mocked(fetchStreaks);

const RESPONSE: StreaksResponse = {
  timezone: 'Europe/Helsinki',
  streaks: [
    {
      streakKey: 'tasks',
      currentLen: 12,
      bestLen: 20,
      lastActiveDate: '2026-09-18',
      activeToday: true,
      last7: [true, true, true, false, true, true, true],
    },
    {
      streakKey: 'japanese-wotd',
      currentLen: 7,
      bestLen: 7,
      lastActiveDate: '2026-09-17',
      activeToday: false,
      last7: [true, true, true, true, true, true, false],
    },
  ],
};

function renderWidget(settings: StreaksSettings = {}): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StreaksWidget settings={settings} size={{ w: 2, h: 2 }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('streakName', () => {
  it('maps known keys through the catalog and passes unknown keys through', () => {
    expect(streakName('tasks')).toBe('Tasks');
    expect(streakName('habit:water')).toBe('habit:water');
  });
});

describe('StreaksWidget', () => {
  it('renders one accessible row per streak with count, best, today state and last-7 text', async () => {
    fetchMock.mockResolvedValue(RESPONSE);
    renderWidget();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName(
      'Tasks — 12-day streak, best 20 active today active 6 of the last 7 days.',
    );
    expect(rows[1]).toHaveAccessibleName(
      'Japanese words — 7-day streak, best 7 today pending active 6 of the last 7 days.',
    );
    expect(screen.getByText('All-time best: 20 days')).toBeInTheDocument();
  });

  it('shows a quiet milestone badge only on an active milestone day', async () => {
    fetchMock.mockResolvedValue(RESPONSE);
    renderWidget();

    await screen.findAllByRole('listitem');
    // 7-day streak but not active today → no badge; 12 is not a milestone.
    expect(screen.queryByText('7 days!')).toBeNull();
  });

  it('honours the visible setting and hides best when asked', async () => {
    fetchMock.mockResolvedValue(RESPONSE);
    renderWidget({ visible: ['tasks'], showBest: false });

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(screen.queryByText(/All-time best/)).toBeNull();
  });

  it('renders the empty state when nothing has been recorded', async () => {
    fetchMock.mockResolvedValue({ timezone: 'UTC', streaks: [] });
    renderWidget();

    expect(await screen.findByText(/No streaks yet/)).toBeInTheDocument();
  });
});
