import Heading from '@tiptap/extension-heading';
import { Extension, mergeAttributes, type Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

/**
 * The journal editor's schema (ADR-016). It must emit exactly the
 * vocabulary `JournalDocSchema` (packages/contracts) allows — 10 nodes,
 * 5 marks — or saves are refused; `editor-extensions.test.ts` runs the real
 * editor's output through the contract to keep the two in step.
 */

/** Doc headings 1–3 render as h3–h5: the page owns h1 (Journal) and h2 (the date). */
export const JOURNAL_HEADING_OFFSET = 2;

const OffsetHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level) + JOURNAL_HEADING_OFFSET;
    return [`h${level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
}).configure({ levels: [1, 2, 3] });

/** http(s) only — the contract refuses every other scheme. */
export const isJournalHref = (href: string): boolean =>
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(href);

/** "example.com" → "https://example.com"; null when it still isn't an http(s) URL. */
export function normalizeJournalHref(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isJournalHref(withScheme) ? withScheme : null;
}

export interface JournalExtensionOptions {
  /** Cmd/Ctrl+K: open the link form. */
  onLinkShortcut?: () => void;
}

export function journalExtensions(options: JournalExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      underline: false,
      heading: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: true,
        isAllowedUri: (url) => isJournalHref(url),
      },
    }),
    OffsetHeading,
    Extension.create({
      name: 'journalLinkShortcut',
      addKeyboardShortcuts() {
        return {
          'Mod-k': (): boolean => {
            options.onLinkShortcut?.();
            return true;
          },
        };
      },
    }),
  ];
}
