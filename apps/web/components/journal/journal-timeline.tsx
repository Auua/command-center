'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type {
  JournalEntrySummary,
  JournalSearchFragment,
  JournalSearchHit,
} from '@command-center/contracts';
import {
  Button,
  Chip,
  ChipRow,
  ErrorText,
  PlusIcon,
  RetryIcon,
  Skeleton,
  WidgetMessage,
  useAnnouncer,
} from '@command-center/ui';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { fetchJournalEntries, fetchJournalExport, fetchJournalSearch } from '@/lib/journal-api';
import { browserToday, formatEntryDate } from '@/lib/journal-format';
import { rememberReturnFocus, takeReturnFocus } from '@/lib/return-focus';

export interface JournalFilters {
  q: string;
  from: string;
  to: string;
  tag: string;
}
const NO_FILTERS: JournalFilters = { q: '', from: '', to: '', tag: '' };
const PAGE_SIZE = 20;

export const rowId = (entryId: string): string => `journal-row-${entryId}`;

/** The `/journal` URL for a set of filters — they live in the URL, so back from an entry keeps them. */
export function journalHref(filters: JournalFilters): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'from', 'to', 'tag'] as const) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  return params.size > 0 ? `/journal?${params.toString()}` : '/journal';
}

const isSearchUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 503;

/**
 * The journal timeline (ADR-016 `/journal`): previews newest first, paged
 * by cursor, filtered by date range and tag, and — with a query — full-text
 * search (4C-2) showing the matching passages. The filters come from the
 * URL (`filters`, parsed by the page) and Search writes them back to it.
 * Export downloads every entry (raw doc + Markdown, NFR-7).
 */
export function JournalTimeline({
  filters = NO_FILTERS,
}: {
  filters?: JournalFilters;
}): ReactElement {
  const formId = useId();
  const router = useRouter();
  const { announce, regions } = useAnnouncer();
  const [draft, setDraft] = useState<JournalFilters>(filters);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  // Back/forward changes the URL under a mounted timeline.
  const { q, from, to, tag } = filters;
  useEffect(() => setDraft({ q, from, to, tag }), [q, from, to, tag]);

  const searching = filters.q !== '';
  const query = useInfiniteQuery({
    queryKey: ['journal', searching ? 'search' : 'timeline', filters],
    queryFn: ({
      pageParam,
    }): Promise<{
      items: (JournalEntrySummary | JournalSearchHit)[];
      nextCursor: string | null;
    }> => {
      const common = {
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.tag ? { tag: filters.tag } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: PAGE_SIZE,
      };
      return searching
        ? fetchJournalSearch({ ...common, q: filters.q })
        : fetchJournalEntries(common);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // A 503 is "the search index is still building" — retrying at once won't help.
    retry: (failures, error) => !isSearchUnavailable(error) && failures < 1,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const filtered = filters.from !== '' || filters.to !== '' || filters.tag !== '' || searching;

  // Say how many entries a search found (the list itself changes silently).
  const found = searching && query.isSuccess ? items.length : null;
  const more = query.hasNextPage;
  useEffect(() => {
    if (found === null) return;
    announce(
      'polite',
      found === 0
        ? t('journal.search.none', { q: filters.q })
        : t(more ? 'journal.search.foundMore' : 'journal.search.found', { count: found }),
    );
  }, [announce, found, more, filters.q]);

  // Back from an entry: focus returns to the row that opened it.
  useEffect(() => {
    for (const item of items) {
      const id = rowId(item.id);
      if (takeReturnFocus(id)) {
        document.getElementById(id)?.focus();
        return;
      }
    }
  }, [items]);

  const apply = (event: FormEvent): void => {
    event.preventDefault();
    router.replace(journalHref(draft), { scroll: false });
  };

  const download = async (): Promise<void> => {
    setExporting(true);
    setExportFailed(false);
    try {
      const data = await fetchJournalExport();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `journal-export-${browserToday()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="cc-journal-timeline">
      {regions}
      <div className="cc-journal-bar">
        <Link href="/journal/new" className="cc-btn">
          <span aria-hidden="true">
            <PlusIcon />
          </span>
          {t('journal.new')}
        </Link>
        <span className="cc-dialog-footer-spacer" />
        <Button variant="ghost" size="sm" busy={exporting} onClick={() => void download()}>
          {t('journal.export')}
        </Button>
      </div>
      {exportFailed && <ErrorText>{t('journal.exportFailed')}</ErrorText>}

      <form className="cc-journal-filters" onSubmit={apply} aria-label={t('journal.filters')}>
        <div className="cc-field cc-journal-search">
          <label htmlFor={`${formId}-q`}>{t('journal.search.label')}</label>
          <input
            id={`${formId}-q`}
            type="search"
            value={draft.q}
            maxLength={200}
            aria-describedby={`${formId}-q-hint`}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
          <p id={`${formId}-q-hint`} className="cc-hint">
            {t('journal.search.hint')}
          </p>
        </div>
        <div className="cc-field">
          <label htmlFor={`${formId}-from`}>{t('journal.filter.from')}</label>
          <input
            id={`${formId}-from`}
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </div>
        <div className="cc-field">
          <label htmlFor={`${formId}-to`}>{t('journal.filter.to')}</label>
          <input
            id={`${formId}-to`}
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="cc-field">
          <label htmlFor={`${formId}-tag`}>{t('journal.filter.tag')}</label>
          <input
            id={`${formId}-tag`}
            type="text"
            value={draft.tag}
            onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          />
        </div>
        <Button type="submit" variant="ghost" size="sm">
          {t('journal.filter.apply')}
        </Button>
        {filtered && (
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setDraft(NO_FILTERS);
              router.replace(journalHref(NO_FILTERS), { scroll: false });
            }}
          >
            {t('journal.filter.clear')}
          </Button>
        )}
      </form>

      {query.isPending ? (
        <Skeleton shapes={['row', 'row', 'row']} label={t('journal.loading')} />
      ) : query.isError ? (
        <WidgetMessage
          tone="error"
          action={{
            label: t('common.retry'),
            icon: <RetryIcon />,
            onClick: () => void query.refetch(),
          }}
        >
          {isSearchUnavailable(query.error)
            ? t('journal.search.unavailable')
            : t('journal.timeline.error')}
        </WidgetMessage>
      ) : items.length === 0 ? (
        <WidgetMessage tone="empty">
          {searching
            ? t('journal.search.none', { q: filters.q })
            : filtered
              ? t('journal.timeline.noMatch')
              : t('journal.timeline.empty')}
        </WidgetMessage>
      ) : (
        <ol className="cc-journal-entries">
          {items.map((item) => (
            <li key={item.id}>
              <article className="cc-journal-entry">
                <h2>
                  <Link
                    id={rowId(item.id)}
                    href={`/journal/${item.id}`}
                    onClick={() => rememberReturnFocus(rowId(item.id))}
                  >
                    {formatEntryDate(item.entryDate)}
                  </Link>
                </h2>
                {'highlights' in item && item.highlights.length > 0 ? (
                  item.highlights.map((passage, index) => (
                    <Passage key={index} fragments={passage} />
                  ))
                ) : (
                  <p className="cc-journal-preview">
                    {item.textPreview || t('journal.timeline.blank')}
                  </p>
                )}
                <div className="cc-journal-meta">
                  <span>{t('journal.words', { count: item.wordCount })}</span>
                  {item.tags.length > 0 && (
                    <ChipRow>
                      {item.tags.map((tag) => (
                        <Chip key={tag} tone="violet">
                          {tag}
                        </Chip>
                      ))}
                    </ChipRow>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      {query.hasNextPage && (
        <Button
          variant="ghost"
          busy={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('journal.timeline.more')}
        </Button>
      )}
    </div>
  );
}

/** A matching passage, its matched words marked — text nodes only, never HTML. */
function Passage({ fragments }: { fragments: JournalSearchFragment[] }): ReactElement {
  return (
    <p className="cc-journal-preview cc-journal-passage">
      <span aria-hidden="true">… </span>
      {fragments.map((fragment, index) =>
        fragment.hit ? <mark key={index}>{fragment.text}</mark> : fragment.text,
      )}
      <span aria-hidden="true"> …</span>
    </p>
  );
}
