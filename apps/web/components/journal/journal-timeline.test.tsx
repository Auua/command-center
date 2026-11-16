import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEntrySummary, JournalSearchHit } from '@command-center/contracts';
import { ApiError } from '@/lib/api';
import { JournalTimeline, journalHref, type JournalFilters } from './journal-timeline';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: (): { replace: typeof replace } => ({ replace }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/journal-api', () => ({
  fetchJournalEntries: vi.fn(),
  fetchJournalSearch: vi.fn(),
  fetchJournalExport: vi.fn(),
}));

import { fetchJournalEntries, fetchJournalSearch } from '@/lib/journal-api';

const NONE: JournalFilters = { q: '', from: '', to: '', tag: '' };

const summary = (id: string, textPreview: string): JournalEntrySummary => ({
  id,
  entryDate: '2026-11-10',
  textPreview,
  wordCount: 4,
  tags: ['birds'],
  promptId: null,
  version: 1,
  createdAt: '2026-11-10T07:00:00.000Z',
  updatedAt: '2026-11-10T07:00:00.000Z',
});

function renderTimeline(filters: JournalFilters = NONE): void {
  // Retries stay as the component sets them; only the delay is removed.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <JournalTimeline filters={filters} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchJournalEntries).mockResolvedValue({
    items: [summary('a1', 'Quiet morning by the lake.')],
    nextCursor: null,
  });
});

describe('journalHref', () => {
  it('keeps only the filters that are set', () => {
    expect(journalHref(NONE)).toBe('/journal');
    expect(journalHref({ q: ' heron lake ', from: '2026-11-01', to: '', tag: 'birds' })).toBe(
      '/journal?q=heron+lake&from=2026-11-01&tag=birds',
    );
  });
});

describe('JournalTimeline search', () => {
  it('lists the timeline when there is no query', async () => {
    renderTimeline();
    expect(await screen.findByText('Quiet morning by the lake.')).toBeInTheDocument();
    expect(fetchJournalSearch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('writes the query and filters to the URL on Search', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'heron');
    await user.type(screen.getByRole('textbox', { name: 'Tag' }), 'birds');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(replace).toHaveBeenCalledWith('/journal?q=heron&tag=birds', { scroll: false });
  });

  it('shows the matching passages with the hits marked, and announces the count', async () => {
    const hit: JournalSearchHit = {
      ...summary('b2', 'Saw the heron again'),
      highlights: [
        [
          { text: 'Saw the ', hit: false },
          { text: 'heron', hit: true },
          { text: ' again', hit: false },
        ],
      ],
    };
    vi.mocked(fetchJournalSearch).mockResolvedValue({ items: [hit], nextCursor: null });
    renderTimeline({ q: 'heron', from: '', to: '', tag: 'birds' });

    const mark = await screen.findByText('heron', { selector: 'mark' });
    const article = mark.closest('article');
    expect(article).not.toBeNull();
    expect(within(article as HTMLElement).getByRole('link')).toHaveAttribute('href', '/journal/b2');
    expect(fetchJournalSearch).toHaveBeenCalledWith({ q: 'heron', tag: 'birds', limit: 20 });
    expect(fetchJournalEntries).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Entries found: 1'));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('heron');
  });

  it('falls back to the preview when only a tag matched', async () => {
    vi.mocked(fetchJournalSearch).mockResolvedValue({
      items: [{ ...summary('c3', 'A walk.'), highlights: [] }],
      nextCursor: 'next',
    });
    renderTimeline({ ...NONE, q: 'birds' });
    expect(await screen.findByText('A walk.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Entries found: 1 so far — more are older',
      ),
    );
  });

  it('says when nothing matches', async () => {
    vi.mocked(fetchJournalSearch).mockResolvedValue({ items: [], nextCursor: null });
    renderTimeline({ ...NONE, q: 'zebra' });
    // Shown in the list's place, and announced.
    const lines = await screen.findAllByText('No entries contain “zebra”.');
    expect(lines.filter((line) => line.getAttribute('role') !== 'status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('No entries contain “zebra”.');
  });

  it('says search is not ready on a 503, without retrying', async () => {
    vi.mocked(fetchJournalSearch).mockRejectedValue(new ApiError('/api/v1/journal/search', 503));
    renderTimeline({ ...NONE, q: 'heron' });
    expect(await screen.findByText(/Search isn’t ready yet/)).toBeInTheDocument();
    expect(fetchJournalSearch).toHaveBeenCalledTimes(1);
  });

  it('clears the query and filters back to the plain timeline', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchJournalSearch).mockResolvedValue({ items: [], nextCursor: null });
    renderTimeline({ ...NONE, q: 'heron' });
    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(replace).toHaveBeenCalledWith('/journal', { scroll: false });
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
  });
});
