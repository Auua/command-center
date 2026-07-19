import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, TodayResponse } from '@command-center/contracts';
import { WidgetCard } from '@command-center/ui';
import { remindersWidgetDefinition } from './index';
import { RemindersWidget } from './reminders-widget';

vi.mock('@/lib/automations-api', () => ({
  fetchToday: vi.fn(),
  fetchAutomations: vi.fn(),
  fetchAutomationTemplates: vi.fn(),
  fetchAutomationRuns: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}));

import {
  createAutomation,
  fetchAutomationTemplates,
  fetchAutomations,
  fetchToday,
  updateAutomation,
} from '@/lib/automations-api';

const fetchTodayMock = vi.mocked(fetchToday);
const fetchAutomationsMock = vi.mocked(fetchAutomations);
const fetchTemplatesMock = vi.mocked(fetchAutomationTemplates);
const createMock = vi.mocked(createAutomation);
const updateMock = vi.mocked(updateAutomation);

const HYDRATION_ID = '11111111-1111-4111-8111-111111111111';
const JOURNAL_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

const TODAY: TodayResponse = {
  slots: [
    {
      automationId: JOURNAL_ID,
      name: 'Journal',
      at: '2026-07-19T21:30:00+03:00',
      enabled: true,
    },
    {
      automationId: HYDRATION_ID,
      name: 'Hydration break',
      at: '2026-07-19T12:00:00+03:00',
      enabled: true,
      run: { status: 'sent', firedAt: '2026-07-19T09:00:04Z' },
    },
  ],
  events: [
    {
      automationId: EVENT_ID,
      name: 'Stretch after tasks',
      eventKey: 'task.completed',
      enabled: false,
    },
  ],
};

function renderWidget(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RemindersWidget settings={{}} size={{ w: 4, h: 2 }} />
    </QueryClientProvider>,
  );
}

function renderInCard(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WidgetCard
        title={remindersWidgetDefinition.title}
        quickActions={remindersWidgetDefinition.quickActions}
      >
        <RemindersWidget settings={{}} size={{ w: 4, h: 2 }} />
      </WidgetCard>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  fetchTodayMock.mockResolvedValue(structuredClone(TODAY));
  fetchTemplatesMock.mockResolvedValue({ items: [] });
});

describe('RemindersWidget', () => {
  it('shows ghost rows while loading, without layout-shifting content', () => {
    fetchTodayMock.mockReturnValue(new Promise(() => undefined));
    renderWidget();
    expect(screen.getByText('Loading reminders…')).toBeInTheDocument();
    expect(document.querySelectorAll('.cc-rem-ghost')).toHaveLength(5);
  });

  it('renders timed slots sorted by time, then event automations after a divider', async () => {
    renderWidget();

    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('Hydration break')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Journal')).toBeInTheDocument();
    expect(screen.getByText('After events')).toBeInTheDocument();
    expect(screen.getByText('Stretch after tasks')).toBeInTheDocument();
  });

  it('shows run outcomes as glyph + text and the switch with an identity-only label', async () => {
    renderWidget();

    expect(await screen.findByText(/✓ sent/)).toBeInTheDocument();
    const journalSwitch = screen.getByRole('switch', { name: 'Journal reminder' });
    expect(journalSwitch).toBeChecked();
    // Paused event automation: off switch + visible "Paused" token.
    expect(screen.getByRole('switch', { name: 'Stretch after tasks reminder' })).not.toBeChecked();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('toggles optimistically and announces success politely', async () => {
    const user = userEvent.setup();
    let resolveUpdate: (value: Automation) => void = () => undefined;
    updateMock.mockImplementation(
      () =>
        new Promise<Automation>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    renderWidget();

    const journalSwitch = await screen.findByRole('switch', { name: 'Journal reminder' });
    await user.click(journalSwitch);

    // Optimistic: flipped before the server answers.
    expect(screen.getByRole('switch', { name: 'Journal reminder' })).not.toBeChecked();
    expect(updateMock).toHaveBeenCalledWith(JOURNAL_ID, { enabled: false });

    // Settle: the refetch reflects the persisted pause.
    fetchTodayMock.mockResolvedValue({
      ...structuredClone(TODAY),
      slots: structuredClone(TODAY).slots.map((slot) =>
        slot.automationId === JOURNAL_ID ? { ...slot, enabled: false } : slot,
      ),
    });
    resolveUpdate({} as Automation);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Journal paused — from next occurrence.',
      ),
    );
    expect(screen.getByRole('switch', { name: 'Journal reminder' })).not.toBeChecked();
  });

  it('rolls back on failure and announces via role="alert"', async () => {
    const user = userEvent.setup();
    updateMock.mockRejectedValue(new Error('500'));
    renderWidget();

    const journalSwitch = await screen.findByRole('switch', { name: 'Journal reminder' });
    await user.click(journalSwitch);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t pause Journal — restored.'),
    );
    expect(screen.getByRole('switch', { name: 'Journal reminder' })).toBeChecked();
  });

  it('shows the error state with a working retry', async () => {
    const user = userEvent.setup();
    fetchTodayMock.mockRejectedValueOnce(new Error('down'));
    renderWidget();

    expect(await screen.findByText('Couldn’t load reminders.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Journal')).toBeInTheDocument();
  });

  it('renders the templates empty state on first run', async () => {
    fetchTodayMock.mockResolvedValue({ slots: [], events: [] });
    fetchTemplatesMock.mockResolvedValue({
      items: [
        {
          id: 'hydration',
          name: 'Hydration break',
          kind: 'recurring',
          schedule: { type: 'daily', time: '12:00' },
          action: { type: 'notify', title: 'Water time', body: null },
        },
      ],
    });
    renderWidget();

    expect(await screen.findByText(/Command Center can nudge you/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Hydration break/ })).toBeInTheDocument();
  });

  it('opens the builder dialog from the card quick action and creates a reminder', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue({} as Automation);
    renderInCard();
    await screen.findByText('Journal');

    await user.click(screen.getByRole('button', { name: 'Add reminder' }));
    const dialog = await screen.findByRole('dialog', { name: 'New reminder' });

    await user.type(within(dialog).getByLabelText('Name'), 'Water');
    await user.click(within(dialog).getByRole('button', { name: 'Create reminder' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: 'Water',
        kind: 'recurring',
        schedule: { type: 'daily', time: '12:00' },
        action: { type: 'notify', title: 'Water', body: null },
        enabled: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New reminder' })).toBeNull());
  });

  it('opens the edit dialog from the row name with the form pre-filled', async () => {
    const user = userEvent.setup();
    fetchAutomationsMock.mockResolvedValue({
      items: [
        {
          id: JOURNAL_ID,
          name: 'Journal',
          kind: 'recurring',
          schedule: { type: 'weekly', time: '21:30', days: [1, 2, 3, 4, 5] },
          eventKey: null,
          action: { type: 'notify', title: 'Journal time', body: null },
          enabled: true,
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      ],
    });
    renderWidget();

    await user.click(await screen.findByRole('button', { name: 'Edit Journal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit reminder' });

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Journal');
    await waitFor(() => expect(within(dialog).getByLabelText('Time')).toHaveValue('21:30'));
    expect(within(dialog).getByRole('radio', { name: 'Weekdays' })).toBeChecked();
    expect(within(dialog).getByText('Send me a notification')).toBeInTheDocument();
  });
});
