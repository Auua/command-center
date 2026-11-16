'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { t, type MessageKey } from '@/lib/i18n';

interface ToolbarAction {
  id: string;
  label: MessageKey;
  glyph: string;
  /** ARIA notation, both platforms. */
  shortcut?: string;
  active?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const ACTIONS: readonly ToolbarAction[] = [
  {
    id: 'bold',
    label: 'journal.toolbar.bold',
    glyph: 'B',
    shortcut: 'Control+B Meta+B',
    active: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'journal.toolbar.italic',
    glyph: 'I',
    shortcut: 'Control+I Meta+I',
    active: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: 'journal.toolbar.strike',
    glyph: 'S',
    shortcut: 'Control+Shift+S Meta+Shift+S',
    active: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'journal.toolbar.code',
    glyph: '</>',
    shortcut: 'Control+E Meta+E',
    active: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: 'link',
    label: 'journal.toolbar.link',
    glyph: '🔗',
    shortcut: 'Control+K Meta+K',
    active: (e) => e.isActive('link'),
    run: () => undefined, // opens the link form — see onLink
  },
  ...([1, 2, 3] as const).map((level): ToolbarAction => ({
    id: `heading-${level}`,
    label: `journal.toolbar.heading${level}`,
    glyph: `H${level}`,
    shortcut: `Control+Alt+${level} Meta+Alt+${level}`,
    active: (e) => e.isActive('heading', { level }),
    run: (e) => e.chain().focus().toggleHeading({ level }).run(),
  })),
  {
    id: 'bullet-list',
    label: 'journal.toolbar.bulletList',
    glyph: '•',
    shortcut: 'Control+Shift+8 Meta+Shift+8',
    active: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered-list',
    label: 'journal.toolbar.orderedList',
    glyph: '1.',
    shortcut: 'Control+Shift+7 Meta+Shift+7',
    active: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    label: 'journal.toolbar.blockquote',
    glyph: '❝',
    shortcut: 'Control+Shift+B Meta+Shift+B',
    active: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'divider',
    label: 'journal.toolbar.divider',
    glyph: '—',
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

/**
 * Formatting toolbar (ADR-016 a11y commitments): one tab stop with roving
 * tabindex (←/→/Home/End move), every toggle a real button with
 * `aria-pressed` tracking the caret, `aria-keyshortcuts` on each, and Esc
 * returning focus to the text.
 */
export function EditorToolbar({
  editor,
  onLink,
}: {
  editor: Editor;
  onLink: () => void;
}): ReactElement {
  const [current, setCurrent] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const pressed = useEditorState({
    editor,
    selector: ({ editor: e }) => ACTIONS.map((action) => action.active?.(e) ?? null),
  });

  const move = (index: number): void => {
    const next = (index + ACTIONS.length) % ACTIONS.length;
    setCurrent(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(current + 1),
      ArrowLeft: () => move(current - 1),
      Home: () => move(0),
      End: () => move(ACTIONS.length - 1),
      Escape: () => editor.commands.focus(),
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  };

  return (
    <div
      className="cc-journal-toolbar"
      role="toolbar"
      aria-label={t('journal.toolbar.label')}
      onKeyDown={onKeyDown}
    >
      {ACTIONS.map((action, index) => {
        const label = t(action.label);
        const isPressed = pressed?.[index];
        return (
          <button
            key={action.id}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            className="cc-journal-tool"
            tabIndex={index === current ? 0 : -1}
            aria-label={label}
            title={label}
            aria-pressed={isPressed === null || isPressed === undefined ? undefined : isPressed}
            aria-keyshortcuts={action.shortcut}
            onFocus={() => setCurrent(index)}
            // Keep the text selection: the editor must not blur on press.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (action.id === 'link' ? onLink() : action.run(editor))}
          >
            <span aria-hidden="true">{action.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

export const TOOLBAR_SHORTCUTS: ReadonlyArray<{ label: MessageKey; keys: string }> = ACTIONS.filter(
  (action) => action.shortcut,
).map((action) => ({
  label: action.label,
  keys: (action.shortcut ?? '').split(' ')[0]?.replace('Control', 'Ctrl') ?? '',
}));
