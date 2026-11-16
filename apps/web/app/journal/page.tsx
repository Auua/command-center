import type { ReactElement } from 'react';
import { JOURNAL_SEARCH_QUERY_MAX } from '@command-center/contracts';
import { JournalTimeline } from '@/components/journal/journal-timeline';

type Params = Record<string, string | string[] | undefined>;

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const date = (value: unknown): string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

/** /journal?q=&from=&to=&tag= — the timeline and search (ADR-016). */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<ReactElement> {
  const params = await searchParams;
  return (
    <JournalTimeline
      filters={{
        q: text(params.q, JOURNAL_SEARCH_QUERY_MAX),
        from: date(params.from),
        to: date(params.to),
        tag: text(params.tag, 32).toLowerCase(),
      }}
    />
  );
}
