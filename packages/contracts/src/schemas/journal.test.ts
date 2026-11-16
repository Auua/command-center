import { describe, expect, it } from 'vitest';
import {
  CreateJournalEntryRequestSchema,
  JOURNAL_DOC_MAX_BYTES,
  JournalDocSchema,
  JournalListQuerySchema,
  JournalPromptCategoriesQuerySchema,
  PatchJournalEntryRequestSchema,
  type JournalDoc,
} from './journal';
import {
  journalDocToMarkdown,
  journalPlainText,
  journalTextPreview,
  journalWordCount,
} from './journal-doc';

/** Exactly what TipTap 3.32 StarterKit's getJSON() emits for every allowed node and mark. */
export const EVERYTHING_DOC: JournalDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hi' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'c' },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'strike' }], text: 'd' },
        { type: 'text', text: ' ' },
        { type: 'text', marks: [{ type: 'code' }], text: 'e' },
        { type: 'text', text: ' ' },
        {
          type: 'text',
          marks: [
            {
              type: 'link',
              attrs: {
                href: 'https://x.y',
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
                class: null,
                title: null,
              },
            },
          ],
          text: 'link',
        },
        { type: 'hardBreak' },
        { type: 'text', text: 'after' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3, type: null },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
    },
    { type: 'horizontalRule' },
    { type: 'paragraph' },
  ],
};

const paragraph = (text: string): JournalDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('JournalDocSchema', () => {
  it('accepts every allowlisted node, mark and attr as the editor emits them', () => {
    expect(JournalDocSchema.parse(EVERYTHING_DOC)).toEqual(EVERYTHING_DOC);
  });

  it('accepts the empty editor doc', () => {
    expect(JournalDocSchema.parse({ type: 'doc', content: [{ type: 'paragraph' }] })).toBeTruthy();
  });

  it.each([
    ['an unknown node', { type: 'doc', content: [{ type: 'codeBlock', content: [] }] }],
    ['an image', { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }],
    [
      'an unknown mark',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }],
          },
        ],
      },
    ],
    [
      'an unknown attr',
      { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }] },
    ],
    ['an unknown field', { type: 'doc', content: [{ type: 'paragraph', html: '<b>x</b>' }] }],
    ['heading level 4', { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 } }] }],
    [
      'an empty text node',
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] },
    ],
    ['a non-doc root', { type: 'paragraph' }],
  ])('rejects %s', (_, doc) => {
    expect(JournalDocSchema.safeParse(doc).success).toBe(false);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative', 'mailto:a@b.c'])(
    'rejects the link href %s',
    (href) => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
          },
        ],
      };
      expect(JournalDocSchema.safeParse(doc).success).toBe(false);
    },
  );

  it('rejects a doc over the size cap', () => {
    const result = JournalDocSchema.safeParse(paragraph('x'.repeat(JOURNAL_DOC_MAX_BYTES)));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/too large/);
  });

  it('rejects a doc nested deeper than the cap', () => {
    let block: unknown = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
    for (let i = 0; i < 20; i += 1) block = { type: 'blockquote', content: [block] };
    const result = JournalDocSchema.safeParse({ type: 'doc', content: [block] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/nested too deeply/);
  });
});

describe('journal requests', () => {
  it('defaults tags and promptId, normalizes tags', () => {
    const parsed = CreateJournalEntryRequestSchema.parse({
      doc: paragraph('x'),
      tags: [' Work ', 'work', 'Rest'],
    });
    expect(parsed).toEqual({ doc: paragraph('x'), tags: ['work', 'rest'], promptId: null });
  });

  it('never accepts client-derived fields', () => {
    expect(
      CreateJournalEntryRequestSchema.safeParse({ doc: paragraph('x'), wordCount: 9 }).success,
    ).toBe(false);
  });

  it('requires something to save on PATCH', () => {
    expect(PatchJournalEntryRequestSchema.safeParse({ baseVersion: 1 }).success).toBe(false);
    expect(PatchJournalEntryRequestSchema.safeParse({ baseVersion: 1, tags: [] }).success).toBe(
      true,
    );
    expect(PatchJournalEntryRequestSchema.safeParse({ doc: paragraph('x') }).success).toBe(false);
  });

  it('parses list queries and prompt categories', () => {
    expect(JournalListQuerySchema.parse({ limit: '5', tag: 'Work' })).toEqual({
      limit: 5,
      tag: 'work',
    });
    expect(JournalPromptCategoriesQuerySchema.parse(undefined)).toEqual([]);
    expect(JournalPromptCategoriesQuerySchema.parse('reflect, growth')).toEqual([
      'reflect',
      'growth',
    ]);
    expect(JournalPromptCategoriesQuerySchema.safeParse('reflect,nope').success).toBe(false);
  });
});

describe('journal doc readers', () => {
  it('derives plain text block by block', () => {
    expect(journalPlainText(EVERYTHING_DOC)).toBe('Hi\na b c d e link\nafter\none\ntwo\nq');
  });

  it('counts words in spaced and unspaced scripts', () => {
    expect(journalWordCount('')).toBe(0);
    expect(journalWordCount('The dog said hi.')).toBe(4);
    expect(journalWordCount('今日は天気がいいです')).toBeGreaterThan(1);
  });

  it('cuts the preview on a word with an ellipsis', () => {
    const text = 'word '.repeat(100);
    const preview = journalTextPreview(text, 50);
    expect([...preview].length).toBeLessThanOrEqual(50);
    expect(preview.endsWith('word…')).toBe(true);
    expect(journalTextPreview('short\n\ntext')).toBe('short text');
  });

  it('renders Markdown for the export', () => {
    expect(journalDocToMarkdown(EVERYTHING_DOC)).toBe(
      [
        '## Hi',
        'a **b** *c* ~~d~~ `e` [link](https://x.y)\\\nafter',
        '- one',
        '3. two',
        '> q',
        '---',
      ].join('\n\n'),
    );
  });

  it('escapes Markdown syntax typed as text', () => {
    expect(journalDocToMarkdown(paragraph('# not a *heading*'))).toBe('\\# not a \\*heading\\*');
    expect(journalDocToMarkdown(paragraph('1. not a list'))).toBe('1\\. not a list');
  });

  it('indents nested list content under its marker', () => {
    const doc: JournalDoc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'outer' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(journalDocToMarkdown(doc)).toBe('- outer\n\n  - inner');
  });
});
