'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { z } from 'zod';
import {
  APPRECIATION_TEXT_MAX,
  type AppreciationEntry,
  type AppreciationListResponse,
} from '@command-center/contracts';
import {
  DismissButton,
  ErrorText,
  List,
  ListItem,
  RetryIcon,
  Skeleton,
  useAnnouncer,
  useQuickAction,
  WidgetBody,
  WidgetMessage,
  type WidgetProps,
} from '@command-center/ui';
import {
  createAppreciation,
  deleteAppreciation,
  fetchAppreciationPrompt,
  fetchAppreciations,
} from '@/lib/appreciation-api';
import { t } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relative-time';

export const appreciationSettingsSchema = z.object({
  recentCount: z.number().int().min(3).max(10).default(3),
  showDailyPrompt: z.boolean().default(true),
});

export type AppreciationSettings = z.input<typeof appreciationSettingsSchema>;

/**
 * Fetched once; `recentCount` of them are shown and "Show more" reveals the
 * rest — a glanceable card, not an archive (ADR-017).
 */
export const APPRECIATION_FETCH_LIMIT = 20;
const LIST_KEY = ['appreciation', 'list', { limit: APPRECIATION_FETCH_LIMIT }] as const;
const MUTATION_KEY = ['appreciation'] as const;
/** How long a deleted entry can be brought back (paused while Undo has focus or hover). */
export const UNDO_MS = 6000;
const PENDING_PREFIX = 'pending-';

/** YYYY-MM-DD in the browser's timezone — "today" for the placeholder rule. */
function localDay(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function newestFirst(items: AppreciationEntry[]): AppreciationEntry[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

interface UndoSlot {
  entry: AppreciationEntry;
  /** Where the entry sat, so dismissing Undo can focus its successor. */
  index: number;
}

/**
 * Appreciation tracker (ADR-017): one-line gratitude capture with the
 * braindump feel (Enter to add, optimistic) and the tasks-style delete undo.
 * The day's prompt is the placeholder until the first entry of the day.
 */
export function AppreciationWidget({ settings }: WidgetProps<AppreciationSettings>): ReactElement {
  const recentCount = settings.recentCount ?? 3;
  const showDailyPrompt = settings.showDailyPrompt ?? true;

  const queryClient = useQueryClient();
  const { announce, regions } = useAnnouncer();
  const inputId = useId();
  const promptId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tempCounter = useRef(0);

  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [undo, setUndo] = useState<UndoSlot | null>(null);
  const [undoPaused, setUndoPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearedThisSession, setClearedThisSession] = useState(false);

  const today = localDay(new Date());

  const listQuery = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => fetchAppreciations(APPRECIATION_FETCH_LIMIT),
  });

  // Presentation sugar: a failed prompt read silently keeps the neutral copy.
  const promptQuery = useQuery({
    queryKey: ['appreciation', 'prompt', today],
    queryFn: () => fetchAppreciationPrompt('en'),
    enabled: showDailyPrompt,
    staleTime: Infinity,
    retry: false,
  });

  useQuickAction('add-appreciation', () => inputRef.current?.focus());

  const setItems = (update: (items: AppreciationEntry[]) => AppreciationEntry[]): void => {
    queryClient.setQueryData<AppreciationListResponse>(LIST_KEY, (current) =>
      current ? { items: update(current.items) } : current,
    );
  };

  // Refetch only once no other appreciation write is in flight, so a burst of
  // adds never has a refetch drop entries that are still being saved.
  const settle = (): void => {
    if (queryClient.isMutating({ mutationKey: MUTATION_KEY }) <= 1) {
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    }
  };

  const addMutation = useMutation({
    mutationKey: [...MUTATION_KEY, 'add'],
    mutationFn: (text: string) => createAppreciation({ text }),
    onMutate: async (text) => {
      await queryClient.cancelQueries({ queryKey: LIST_KEY });
      tempCounter.current += 1;
      const tempId = `${PENDING_PREFIX}${tempCounter.current}`;
      setItems((items) => [
        { id: tempId, text, tags: [], createdAt: new Date().toISOString() },
        ...items,
      ]);
      return { tempId };
    },
    onSuccess: (entry, _text, context) => {
      setItems((items) => items.map((item) => (item.id === context?.tempId ? entry : item)));
      announce('polite', t('appreciation.announce.added'));
    },
    onError: (_error, text, context) => {
      setItems((items) => items.filter((item) => item.id !== context?.tempId));
      // Never lose what was typed: it goes back into an empty input.
      setDraft((current) => (current.trim() ? current : text));
      setError(t('appreciation.error.save'));
      announce('alert', t('appreciation.error.save'));
    },
    onSettled: settle,
  });

  const deleteMutation = useMutation({
    mutationKey: [...MUTATION_KEY, 'delete'],
    mutationFn: (entry: AppreciationEntry) => deleteAppreciation(entry.id),
    onError: (_error, entry) => {
      setItems((items) => newestFirst([entry, ...items.filter((item) => item.id !== entry.id)]));
      setUndo((slot) => (slot?.entry.id === entry.id ? null : slot));
      setError(t('appreciation.error.delete'));
      announce('alert', t('appreciation.error.delete'));
    },
    onSettled: settle,
  });

  // Undo re-POSTs the text: delete is hard (ADR-017), so the restored entry
  // is a new row with a fresh timestamp.
  const restoreMutation = useMutation({
    mutationKey: [...MUTATION_KEY, 'restore'],
    mutationFn: (entry: AppreciationEntry) =>
      createAppreciation({ text: entry.text, tags: entry.tags }),
    onSuccess: (created) => {
      setItems((items) => newestFirst([created, ...items]));
      announce('polite', t('appreciation.announce.restored'));
    },
    onError: (_error, entry) => {
      setDraft((current) => (current.trim() ? current : entry.text));
      setError(t('appreciation.error.restore'));
      announce('alert', t('appreciation.error.restore'));
    },
    onSettled: settle,
  });

  const items = listQuery.data?.items ?? [];

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    setDraft('');
    addMutation.mutate(text.slice(0, APPRECIATION_TEXT_MAX));
  }

  function handleDelete(entry: AppreciationEntry): void {
    const index = items.findIndex((item) => item.id === entry.id);
    setError(null);
    // A refetch already in flight must not bring the entry back.
    void queryClient.cancelQueries({ queryKey: LIST_KEY });
    setItems((current) => current.filter((item) => item.id !== entry.id));
    setUndo({ entry, index: Math.max(index, 0) });
    setUndoPaused(false);
    if (items.length === 1) setClearedThisSession(true);
    announce('polite', t('appreciation.announce.deleted'));
    deleteMutation.mutate(entry);
  }

  /** After Undo is dismissed: the entry that took the deleted one's place, else the input. */
  function focusAfterUndo(index: number): void {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-entry-delete]');
    const target =
      buttons && buttons.length > 0 ? buttons[Math.min(index, buttons.length - 1)] : null;
    (target ?? inputRef.current)?.focus();
  }

  function handleUndo(): void {
    if (!undo) return;
    const { entry } = undo;
    // Focus lands on the input before the Undo row unmounts — never on <body>.
    inputRef.current?.focus();
    setUndo(null);
    restoreMutation.mutate(entry);
  }

  function dismissUndo(): void {
    if (!undo) return;
    const { index } = undo;
    setUndo(null);
    focusAfterUndo(index);
  }

  // Delete moves focus onto Undo (ADR-017 accessibility); the row is then
  // paused until focus or the pointer leaves it.
  const undoEntryId = undo?.entry.id;
  useEffect(() => {
    if (undoEntryId) undoRef.current?.focus();
  }, [undoEntryId]);

  useEffect(() => {
    if (!undo || undoPaused) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return (): void => window.clearTimeout(timer);
  }, [undo, undoPaused]);

  const hasEntryToday = items.some((item) => localDay(new Date(item.createdAt)) === today);
  const prompt =
    showDailyPrompt && !hasEntryToday && promptQuery.data ? promptQuery.data.text : null;

  const visible = expanded ? items : items.slice(0, recentCount);
  const hidden = items.length - visible.length;

  let body: ReactElement;
  if (listQuery.isPending) {
    body = (
      <Skeleton
        shapes={Array.from({ length: recentCount }, () => 'row' as const)}
        label={t('appreciation.loading')}
      />
    );
  } else if (listQuery.isError) {
    body = (
      <WidgetMessage
        tone="error"
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void listQuery.refetch(),
        }}
      >
        {t('appreciation.error.load')}
      </WidgetMessage>
    );
  } else if (items.length === 0) {
    body = (
      <WidgetMessage>
        {clearedThisSession ? t('appreciation.cleared') : t('appreciation.empty')}
      </WidgetMessage>
    );
  } else {
    body = (
      <>
        <div ref={listRef} className="cc-appreciation-entries">
          <List className="cc-appreciation-list">
            {visible.map((entry) => {
              const pending = entry.id.startsWith(PENDING_PREFIX);
              return (
                <ListItem
                  key={entry.id}
                  className={
                    pending
                      ? 'cc-appreciation-item cc-appreciation-item-pending'
                      : 'cc-appreciation-item'
                  }
                >
                  <div className="cc-appreciation-item-main">
                    <p className="cc-appreciation-item-text">{entry.text}</p>
                    <time className="cc-appreciation-item-time" dateTime={entry.createdAt}>
                      {pending ? t('appreciation.saving') : formatRelativeTime(entry.createdAt)}
                    </time>
                  </div>
                  {!pending && (
                    <DismissButton
                      data-entry-delete=""
                      label={t('appreciation.delete', { text: entry.text.slice(0, 60) })}
                      onClick={() => handleDelete(entry)}
                    />
                  )}
                </ListItem>
              );
            })}
          </List>
        </div>
        {items.length > recentCount && (
          <button
            type="button"
            className="cc-btn cc-btn-link cc-btn-sm cc-appreciation-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('appreciation.showFewer') : t('appreciation.showMore', { count: hidden })}
          </button>
        )}
      </>
    );
  }

  return (
    <WidgetBody className="cc-appreciation">
      <form className="cc-appreciation-form" onSubmit={handleSubmit}>
        <label className="cc-appreciation-label" htmlFor={inputId}>
          {t('appreciation.label')}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="cc-appreciation-input"
          type="text"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={APPRECIATION_TEXT_MAX}
          placeholder={prompt ?? t('appreciation.placeholder')}
          aria-describedby={prompt ? promptId : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {prompt && (
          <span id={promptId} className="cc-visually-hidden">
            {t('appreciation.promptDescription', { prompt })}
          </span>
        )}
        {/* Hidden submit keeps Enter-to-add discoverable to assistive tech. */}
        <button type="submit" className="cc-visually-hidden" disabled={draft.trim().length === 0}>
          {t('appreciation.add')}
        </button>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {undo && (
        <div
          className="cc-appreciation-undo"
          onFocus={() => setUndoPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setUndoPaused(false);
            }
          }}
          onMouseEnter={() => setUndoPaused(true)}
          onMouseLeave={() => setUndoPaused(false)}
        >
          <span>{t('appreciation.deleted')}</span>
          <button
            ref={undoRef}
            type="button"
            className="cc-btn cc-btn-link cc-btn-sm"
            onClick={handleUndo}
          >
            {t('appreciation.undo')}
          </button>
          <DismissButton label={t('appreciation.dismissUndo')} onClick={dismissUndo} />
        </div>
      )}
      {body}
      {regions}
    </WidgetBody>
  );
}
