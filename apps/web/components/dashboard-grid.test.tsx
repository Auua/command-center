import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
