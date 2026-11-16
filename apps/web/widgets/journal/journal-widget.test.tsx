import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalToday } from '@command-center/contracts';
import { createQuickActionBus, QuickActionProvider } from '@command-center/ui';
import { rememberReturnFocus } from '@/lib/return-focus';
import { JOURNAL_CTA_ID, JournalWidget, type JournalSettings } from './journal-widget';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: (): { push: typeof push } => ({ push }) }));
vi.mock('@/lib/journal-api', () => ({ fetchJournalToday: vi.fn() }));
import { fetchJournalToday } from '@/lib/journal-api';
const todayMock = vi.mocked(fetchJournalToday);

const PROMPT = { id: 'surprise', text: 'What surprised you today?' };
const TODAY: JournalToday = { date: '2026-11-16', prompt: PROMPT, entry: null, entriesToday: 0 };

function renderWidget(settings: JournalSettings = {}): ReturnType<typeof createQuickActionBus> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bus = createQuickActionBus();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <QuickActionProvider value={bus}>
        <JournalWidget settings={settings} size={{ w: 2, h: 2 }} />
      </QuickActionProvider>
    </QueryClientProvider>
  );
  render(ui);
  return bus;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('JournalWidget', () => {
  it('offers today’s prompt with the write button described by it', async () => {
    todayMock.mockResolvedValue(TODAY);
    renderWidget();
    const cta = await screen.findByRole('link', { name: 'Write today’s entry' });
    expect(cta).toHaveAccessibleDescription(PROMPT.text);
    expect(cta).toHaveAttribute('href', '/journal/new?from=dashboard&promptId=surprise');
    expect(screen.getByRole('link', { name: 'All entries' })).toHaveAttribute('href', '/journal');
  });

  it('switches to editing once today has an entry', async () => {
    todayMock.mockResolvedValue({
      ...TODAY,
      entriesToday: 1,
      entry: {
        id: '6740a1b2c3d4e5f601234567',
        entryDate: '2026-11-16',
        textPreview: 'Long walk by the sea.',
        wordCount: 5,
        tags: [],
        promptId: 'surprise',
        version: 2,
        createdAt: '2026-11-16T08:00:00.000Z',
        updatedAt: '2026-11-16T08:05:00.000Z',
      },
    });
    renderWidget();
    const cta = await screen.findByRole('link', { name: 'Edit today’s entry' });
    expect(cta).toHaveAttribute('href', '/journal/6740a1b2c3d4e5f601234567?from=dashboard');
    expect(screen.getByText('Long walk by the sea.')).toBeInTheDocument();
    expect(screen.getByText('Written today · 5 words')).toBeInTheDocument();
    expect(screen.queryByText(PROMPT.text)).toBeNull();
  });

  it('hides the prompt when switched off and passes chosen topics to the API', async () => {
    todayMock.mockResolvedValue(TODAY);
    renderWidget({ showPrompt: false, promptCategories: ['growth'] });
    const cta = await screen.findByRole('link', { name: 'Write today’s entry' });
    expect(screen.queryByText(PROMPT.text)).toBeNull();
    expect(cta).toHaveAttribute('href', '/journal/new?from=dashboard');
    expect(todayMock).toHaveBeenCalledWith(['growth']);
  });

  it('opens a new entry on the "Write entry" quick action', async () => {
    todayMock.mockResolvedValue(TODAY);
    const bus = renderWidget();
    await screen.findByRole('link', { name: 'Write today’s entry' });
    act(() => bus.dispatch('write-journal'));
    expect(push).toHaveBeenCalledWith('/journal/new?from=dashboard&promptId=surprise');
  });

  it('returns focus to the button after coming back from the editor', async () => {
    todayMock.mockResolvedValue(TODAY);
    rememberReturnFocus(JOURNAL_CTA_ID);
    renderWidget();
    expect(await screen.findByRole('link', { name: 'Write today’s entry' })).toHaveFocus();
  });

  it('still lets you write when the API is down', async () => {
    todayMock.mockRejectedValue(new Error('down'));
    renderWidget();
    expect(await screen.findByText('Couldn’t load today’s journal.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Write anyway — it saves in this browser' }),
    ).toHaveAttribute('href', '/journal/new?from=dashboard');
  });
});
