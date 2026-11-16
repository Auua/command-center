import {
  JOURNAL_PREVIEW_LENGTH,
  type JournalBlockNode,
  type JournalDoc,
  type JournalInlineNode,
  type JournalListItemNode,
} from './journal';

/**
 * Pure readers over a validated journal doc (ADR-016). The API derives an
 * entry's `plainText`, `textPreview` and `wordCount` here on every save —
 * never from the client — and the export renders Markdown here. The
 * vocabulary is the contract's allowlist, so every node type is handled
 * explicitly and the API needs no editor dependency.
 */

function inlineText(content: readonly JournalInlineNode[] | undefined): string {
  return (content ?? []).map((node) => (node.type === 'text' ? node.text : '\n')).join('');
}

function blockLines(block: JournalBlockNode): string[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return [inlineText(block.content)];
    case 'blockquote':
      return block.content.flatMap(blockLines);
    case 'bulletList':
    case 'orderedList':
      return block.content.flatMap((item) => item.content.flatMap(blockLines));
    case 'horizontalRule':
      return [];
  }
}

/** One line per block (hard breaks become newlines); the search source. */
export function journalPlainText(doc: JournalDoc): string {
  return (doc.content ?? [])
    .flatMap(blockLines)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Words, the way a reader would count them in any script: `Intl.Segmenter`
 * splits Japanese (no spaces) into words too, so a Japanese entry is not
 * "one word".
 */
export function journalWordCount(text: string): number {
  if (!text.trim()) return 0;
  if (typeof Intl.Segmenter === 'function') {
    let count = 0;
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }
  return text.trim().split(/\s+/).length;
}

/** Whitespace collapsed, at most JOURNAL_PREVIEW_LENGTH characters, cut on a word. */
export function journalTextPreview(text: string, max: number = JOURNAL_PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ── Markdown (export, NFR-7) ───────────────────────────────────────────────

const ESCAPED = /[\\`*_[\]~<>]/g;

function escapeText(text: string): string {
  return text.replace(ESCAPED, (char) => `\\${char}`);
}

/** A line that would otherwise start a heading, quote, list or rule. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(\d+)([.)]\s)/, '$1$2\\$3')
    .replace(/^(\s*)(#{1,6}\s|[-+]\s|-{3,}\s*$)/, '$1\\$2');
}

function codeSpan(text: string): string {
  const fence = text.includes('`') ? '``' : '`';
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineMarkdown(content: readonly JournalInlineNode[] | undefined): string {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'hardBreak') return '\\\n';
      const marks = node.marks ?? [];
      const has = (type: string): boolean => marks.some((mark) => mark.type === type);
      let out = has('code') ? codeSpan(node.text) : escapeText(node.text);
      if (has('bold')) out = `**${out}**`;
      if (has('italic')) out = `*${out}*`;
      if (has('strike')) out = `~~${out}~~`;
      const link = marks.find((mark) => mark.type === 'link');
      if (link && link.type === 'link') {
        out = `[${out}](${link.attrs.href.replace(/[()\s]/g, encodeURIComponent)})`;
      }
      return out;
    })
    .join('');
}

function indent(text: string, prefix: string, rest: string): string {
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? prefix : line ? rest : '') + line)
    .join('\n');
}

function listItemMarkdown(item: JournalListItemNode, marker: string): string {
  const body = item.content.map(blockMarkdown).join('\n\n');
  return indent(body, marker, ' '.repeat(marker.length));
}

function blockMarkdown(block: JournalBlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return escapeLineStart(inlineMarkdown(block.content));
    case 'heading':
      return `${'#'.repeat(block.attrs.level)} ${inlineMarkdown(block.content)}`;
    case 'blockquote':
      return block.content
        .map(blockMarkdown)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bulletList':
      return block.content.map((item) => listItemMarkdown(item, '- ')).join('\n');
    case 'orderedList': {
      const start = block.attrs?.start ?? 1;
      return block.content
        .map((item, index) => listItemMarkdown(item, `${start + index}. `))
        .join('\n');
    }
    case 'horizontalRule':
      return '---';
  }
}

/** CommonMark rendering of a doc — lossless for the allowlisted vocabulary. */
export function journalDocToMarkdown(doc: JournalDoc): string {
  return (doc.content ?? [])
    .map(blockMarkdown)
    .filter((block) => block !== '')
    .join('\n\n');
}
