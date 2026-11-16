'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type { JournalDoc, JournalEntry } from '@command-center/contracts';
import { Button, RetryIcon, Skeleton, WidgetMessage } from '@command-center/ui';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  createJournalEntry,
  deleteJournalEntry,
  fetchJournalEntry,
  fetchJournalToday,
  patchJournalEntry,
} from '@/lib/journal-api';
import { JournalAutosave, reconcileDraft, type AutosaveOptions } from '@/lib/journal-autosave';
import {
  draftKeyForEntry,
  draftKeyForNew,
  getDraftStore,
  type DraftStore,
  type JournalDraft,
} from '@/lib/journal-drafts';
import {
  browserToday,
  EMPTY_JOURNAL_DOC,
  formatEntryDate,
  formatSavedAt,
  parseTags,
} from '@/lib/journal-format';
import { useOtherTabEditing } from '@/lib/use-other-tab';
import { DeleteEntryDialog } from './delete-entry-dialog';
import { journalExtensions } from './editor-extensions';
import { EditorToolbar, TOOLBAR_SHORTCUTS } from './editor-toolbar';
import { LinkForm } from './link-form';
import { SaveStatusIndicator } from './save-status';

export interface JournalEditorScreenProps {
  /** A saved entry; absent for /journal/new. */
  entryId?: string;
  /** /journal/new?date= — defaults to today in the home timezone. */
  date?: string;
  /** /journal/new?promptId= — the prompt the launcher showed. */
  promptId?: string;
  /** Where "Back" goes: the dashboard when opened from the widget. */
  from?: 'dashboard';
}

type Initial = Omit<AutosaveOptions, 'api' | 'drafts' | 'onCreated'>;

const AUTOSAVE_API = {
  create: createJournalEntry,
  patch: patchJournalEntry,
  get: fetchJournalEntry,
};

/**
 * The journal editor page (ADR-016). Loads the server copy and any local
 * draft, reconciles them, then hands over to the workspace — which writes
 * every keystroke to the draft store and autosaves. Writing never waits on
 * the API: a new entry opens even when it is down.
 */
export default function JournalEditorScreen(props: JournalEditorScreenProps): ReactElement {
  const { entryId } = props;
  const [drafts, setDrafts] = useState<DraftStore | null>(null);
  const [draft, setDraft] = useState<{ key: string; value: JournalDraft | null } | null>(null);

  useEffect(() => {
    let live = true;
    void getDraftStore().then((store) => {
      if (live) setDrafts(store);
    });
    return (): void => {
      live = false;
    };
  }, []);

  const entryQuery = useQuery({
    queryKey: ['journal-editor', 'entry', entryId],
    queryFn: () => fetchJournalEntry(entryId ?? ''),
    enabled: Boolean(entryId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const todayQuery = useQuery({
    queryKey: ['journal-editor', 'today'],
    queryFn: () => fetchJournalToday(),
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const entryDate = props.date ?? todayQuery.data?.date ?? browserToday();
  const ready = entryId ? !entryQuery.isPending : !todayQuery.isPending || Boolean(props.date);
  const key = entryId ? draftKeyForEntry(entryId) : draftKeyForNew(entryDate);

  useEffect(() => {
    if (!drafts || !ready) return;
    let live = true;
    void drafts
      .get(key)
      .catch(() => null)
      .then((value) => {
        if (live) setDraft({ key, value });
      });
    return (): void => {
      live = false;
    };
  }, [drafts, ready, key]);

  const backHref = props.from === 'dashboard' ? '/' : '/journal';
  const search = props.from === 'dashboard' ? '?from=dashboard' : '';

  // Once the editor is open it stays open: later query refetches (an
  // errored query flips back to pending) must never unmount it mid-sentence.
  const opened = useRef<{ key: string; workspace: ReactElement } | null>(null);
  if (opened.current?.key === key) return opened.current.workspace;

  if (!drafts || !ready || draft?.key !== key) {
    return <Skeleton shapes={['title', 'line', 'line', 'short']} label={t('journal.loading')} />;
  }

  const server = entryQuery.data ?? null;
  let initial: Initial;
  if (entryId) {
    if (!server && !draft.value) {
      const missing = entryQuery.error instanceof ApiError && entryQuery.error.status === 404;
      return (
        <WidgetMessage
          tone="error"
          hint={<Link href={backHref}>{t('journal.back')}</Link>}
          action={
            missing
              ? undefined
              : {
                  label: t('common.retry'),
                  icon: <RetryIcon />,
                  onClick: () => void entryQuery.refetch(),
                }
          }
        >
          {missing ? t('journal.notFound') : t('journal.loadError')}
        </WidgetMessage>
      );
    }
    const reconciled = reconcileDraft(server, draft.value);
    initial = {
      entryId,
      version: server?.version ?? draft.value?.baseVersion ?? null,
      lastSavedAt: server?.updatedAt ?? null,
      entryDate: server?.entryDate ?? draft.value?.entryDate ?? entryDate,
      promptId: server?.promptId ?? draft.value?.promptId ?? null,
      doc: reconciled?.doc ?? server?.doc ?? EMPTY_JOURNAL_DOC,
      tags: reconciled?.tags ?? server?.tags ?? [],
      restored: reconciled?.restored ?? false,
      conflict: reconciled?.conflict ?? null,
    };
  } else {
    initial = {
      entryId: null,
      version: null,
      entryDate,
      promptId: draft.value?.promptId ?? props.promptId ?? null,
      doc: draft.value?.doc ?? EMPTY_JOURNAL_DOC,
      tags: draft.value?.tags ?? [],
      restored: Boolean(draft.value),
    };
  }

  const prompt = todayQuery.data?.prompt;
  const promptText =
    prompt && initial.promptId === prompt.id && initial.entryDate === todayQuery.data?.date
      ? prompt.text
      : null;

  const workspace = (
    <JournalWorkspace
      key={key}
      initial={initial}
      drafts={drafts}
      promptText={promptText}
      backHref={backHref}
      search={search}
    />
  );
  opened.current = { key, workspace };
  return workspace;
}

function JournalWorkspace({
  initial,
  drafts,
  promptText,
  backHref,
  search,
}: {
  initial: Initial;
  drafts: DraftStore;
  promptText: string | null;
  backHref: string;
  search: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const promptId = useId();
  const tagsId = useId();
  const [engine] = useState(
    () =>
      new JournalAutosave({
        ...initial,
        api: AUTOSAVE_API,
        drafts,
        // Swap /journal/new for the entry's own URL without remounting the
        // editor (the caret stays put); a reload then opens the saved entry.
        onCreated: (entry): void =>
          window.history.replaceState(null, '', `/journal/${entry.id}${search}`),
      }),
  );
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const otherTab = useOtherTabEditing(
    snapshot.entryId ? draftKeyForEntry(snapshot.entryId) : draftKeyForNew(initial.entryDate),
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tagsText, setTagsText] = useState(initial.tags.join(', '));
  const savedTags = useRef(initial.tags);

  const extensions = useMemo(
    () => journalExtensions({ onLinkShortcut: () => setLinkOpen(true) }),
    [],
  );
  const editor = useEditor({
    extensions,
    content: initial.doc,
    immediatelyRender: false,
    autofocus: 'end',
    onUpdate: ({ editor: current }) => engine.edit({ doc: current.getJSON() as JournalDoc }),
    onBlur: () => void engine.flush(),
    editorProps: {
      attributes: {
        class: 'cc-journal-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('journal.editor.label'),
        ...(promptText ? { 'aria-describedby': promptId } : {}),
      },
    },
  });

  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') void engine.flush();
    };
    const flush = (): void => void engine.flush();
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', flush);
    return (): void => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', flush);
      // Leaving the page: last save attempt, then let the card and timeline
      // refresh. Only theirs — the editor's own queries ('journal-editor')
      // are never invalidated from here.
      engine.dispose();
      void queryClient.invalidateQueries({ queryKey: ['journal'] });
    };
  }, [engine, queryClient]);

  const commitTags = (): void => {
    const tags = parseTags(tagsText);
    setTagsText(tags.join(', '));
    if (tags.join(',') !== savedTags.current.join(',')) {
      savedTags.current = tags;
      engine.edit({ tags });
    }
  };

  const applyServerCopy = (entry: JournalEntry | null): void => {
    if (!entry || !editor) return;
    editor.commands.setContent(entry.doc, { emitUpdate: false });
    setTagsText(entry.tags.join(', '));
    savedTags.current = entry.tags;
  };

  const conflict = snapshot.conflict;

  return (
    <div className="cc-journal-editor">
      <div className="cc-journal-bar">
        <Link href={backHref} className="cc-btn cc-btn-ghost cc-btn-sm">
          <span aria-hidden="true">←</span>{' '}
          {t(backHref === '/' ? 'journal.backDashboard' : 'journal.back')}
        </Link>
        <h2 className="cc-journal-date">{formatEntryDate(initial.entryDate)}</h2>
        <SaveStatusIndicator
          status={snapshot.status}
          isNew={snapshot.entryId === null}
          durable={drafts.durable}
        />
        {snapshot.entryId && (
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            {t('journal.delete.open')}
          </Button>
        )}
      </div>

      {otherTab && <WidgetMessage tone="info">{t('journal.otherTab')}</WidgetMessage>}

      {conflict && (
        <div className="cc-journal-conflict" role="alert">
          <p>
            {conflict.server
              ? t('journal.conflict.body', {
                  server: formatSavedAt(conflict.server.updatedAt),
                  local: formatSavedAt(conflict.localEditedAt),
                })
              : t('journal.conflict.unreadable')}
          </p>
          <div className="cc-journal-conflict-actions">
            <Button size="sm" onClick={() => void engine.resolveConflict('keep')}>
              {t('journal.conflict.keep')}
            </Button>
            {conflict.server && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => applyServerCopy(await engine.resolveConflict('discard'))}
              >
                {t('journal.conflict.discard')}
              </Button>
            )}
          </div>
        </div>
      )}

      {snapshot.status === 'rejected' && (
        <WidgetMessage tone="error">{t('journal.rejected')}</WidgetMessage>
      )}

      {promptText && (
        <p id={promptId} className="cc-journal-prompt">
          <span className="cc-visually-hidden">{t('journal.promptLabel')} </span>
          {promptText}
        </p>
      )}

      {editor && <EditorToolbar editor={editor} onLink={() => setLinkOpen(true)} />}
      {editor && linkOpen && <LinkForm editor={editor} onClose={() => setLinkOpen(false)} />}
      <EditorContent editor={editor} className="cc-journal-surface" />

      <div className="cc-field cc-journal-tags">
        <label htmlFor={tagsId}>{t('journal.tags.label')}</label>
        <input
          id={tagsId}
          type="text"
          value={tagsText}
          aria-describedby={`${tagsId}-hint`}
          onChange={(event) => setTagsText(event.target.value)}
          onBlur={commitTags}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTags();
            }
          }}
        />
        <p id={`${tagsId}-hint`} className="cc-hint">
          {t('journal.tags.hint')}
        </p>
      </div>

      <details className="cc-journal-shortcuts">
        <summary>{t('journal.shortcuts')}</summary>
        <dl>
          {TOOLBAR_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.label}>
              <dt>{t(shortcut.label)}</dt>
              <dd>
                <kbd>{shortcut.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <DeleteEntryDialog
        open={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          const id = snapshot.entryId;
          if (!id) return;
          await deleteJournalEntry(id);
          engine.abandon();
          await drafts.delete(draftKeyForEntry(id)).catch(() => undefined);
          setDeleting(false);
          await queryClient.invalidateQueries({ queryKey: ['journal'] });
          router.push(backHref);
        }}
      />
    </div>
  );
}
