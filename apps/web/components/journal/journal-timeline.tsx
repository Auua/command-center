'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import {
  Button,
  Chip,
  ChipRow,
  ErrorText,
  PlusIcon,
  RetryIcon,
  Skeleton,
  WidgetMessage,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { fetchJournalEntries, fetchJournalExport } from '@/lib/journal-api';
import { browserToday, formatEntryDate } from '@/lib/journal-format';
import { rememberReturnFocus, takeReturnFocus } from '@/lib/return-focus';

interface Filters {
  from: string;
  to: string;
  tag: string;
}
const NO_FILTERS: Filters = { from: '', to: '', tag: '' };
const PAGE_SIZE = 20;

export const rowId = (entryId: string): string => `journal-row-${entryId}`;

/**
 * The journal timeline (ADR-016 `/journal`): previews newest first, paged
 * by cursor, filtered by date range and tag. Full-text search arrives with
 * step 4C-2. Export downloads every entry (raw doc + Markdown, NFR-7).
 */
export function JournalTimeline(): ReactElement {
  const formId = useId();
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ['journal', 'timeline', filters],
    queryFn: ({ pageParam }) =>
      fetchJournalEntries({
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.tag.trim() ? { tag: filters.tag.trim() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: PAGE_SIZE,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const filtered = filters.from !== '' || filters.to !== '' || filters.tag.trim() !== '';

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
    setFilters(draft);
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
              setFilters(NO_FILTERS);
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
          {t('journal.timeline.error')}
        </WidgetMessage>
      ) : items.length === 0 ? (
        <WidgetMessage tone="empty">
          {filtered ? t('journal.timeline.noMatch') : t('journal.timeline.empty')}
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
                <p className="cc-journal-preview">
                  {item.textPreview || t('journal.timeline.blank')}
                </p>
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
