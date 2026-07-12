'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { z } from 'zod';
import { createBraindumpNote, deleteBraindumpNote, fetchBraindumpNotes } from '@/lib/braindump-api';

export const braindumpSettingsSchema = z.object({});

export type BraindumpSettings = z.input<typeof braindumpSettingsSchema>;

const QUERY_KEY = ['braindump'];

/**
 * Casual note age, per the design mock: "20 minutes ago", "yesterday, 21:14",
 * falling back to "Jul 8, 09:14" for anything older.
 */
function formatTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;

  const time = then.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff === 0) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (dayDiff === 1) return `yesterday, ${time}`;
  const date = then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${date}, ${time}`;
}

function PencilIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
    </svg>
  );
}

/**
 * Braindump — quick, frictionless thought capture (first Mongo-backed
 * widget, ARD §9 Phase 1). Mirrors the design mock's card: a pill-shaped
 * capture input on top, then a flat list of notes (newest first) separated
 * by hairlines, each with a casual relative timestamp.
 */
export function BraindumpWidget(): ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const notesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchBraindumpNotes,
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: createBraindumpNote,
    onSuccess: () => {
      setDraft('');
      return invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBraindumpNote,
    onSuccess: invalidate,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = draft.trim();
    if (!content || createMutation.isPending) return;
    createMutation.mutate(content);
  }

  return (
    <div className="cc-braindump">
      <form className="cc-braindump-form" onSubmit={handleSubmit}>
        <span className="cc-braindump-form-icon" aria-hidden="true">
          <PencilIcon />
        </span>
        <label className="cc-visually-hidden" htmlFor="cc-braindump-input">
          Dump a thought
        </label>
        <textarea
          id="cc-braindump-input"
          className="cc-braindump-input"
          placeholder="Dump a thought — it lands here, sort it later"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits; Shift+Enter makes a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {/* Hidden submit keeps Enter-to-add reliable and discoverable to AT. */}
        <button
          type="submit"
          className="cc-visually-hidden"
          disabled={createMutation.isPending || draft.trim().length === 0}
        >
          Add
        </button>
      </form>

      {createMutation.isError && (
        <p className="cc-braindump-error" role="alert">
          Couldn&rsquo;t save that thought — try again.
        </p>
      )}

      {notesQuery.isPending ? (
        <p className="cc-widget-placeholder" role="status">
          Loading notes…
        </p>
      ) : notesQuery.isError ? (
        <p className="cc-braindump-error" role="alert">
          Couldn&rsquo;t load braindump notes.
        </p>
      ) : notesQuery.data.items.length === 0 ? (
        <p className="cc-widget-placeholder">
          Empty head, full heart. Dump your first thought above.
        </p>
      ) : (
        <ul className="cc-braindump-list">
          {notesQuery.data.items.map((note) => (
            <li key={note.id} className="cc-braindump-item">
              <div className="cc-braindump-item-main">
                <p className="cc-braindump-item-content">{note.content}</p>
                <time className="cc-braindump-item-time" dateTime={note.createdAt}>
                  {formatTimestamp(note.createdAt)}
                </time>
              </div>
              <button
                type="button"
                className="cc-braindump-delete"
                aria-label={`Delete note: ${note.content.slice(0, 40)}`}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(note.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
