import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { JournalDocSchema } from '@command-center/contracts';
import { journalExtensions, normalizeJournalHref } from './editor-extensions';

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(content: string): Editor {
  editor = new Editor({ extensions: journalExtensions(), content });
  return editor;
}

describe('journal editor schema ↔ contract', () => {
  it('emits only what the contract accepts, for every node and mark the toolbar offers', () => {
    const e = open(
      '<h1>One</h1><h2>Two</h2><h3>Three</h3>' +
        '<p>a <strong>b</strong> <em>c</em> <s>d</s> <code>e</code> <a href="https://example.com">f</a><br>g</p>' +
        '<ul><li><p>bullet</p><ul><li><p>nested</p></li></ul></li></ul>' +
        '<ol start="4"><li><p>numbered</p></li></ol>' +
        '<blockquote><p>quote</p></blockquote><hr><p></p>',
    );
    const json = e.getJSON();
    const parsed = JournalDocSchema.safeParse(json);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(JSON.stringify(json)).toContain('"level":3');
  });

  it('drops what the journal does not allow when it is pasted in', () => {
    const e = open(
      '<h4>deep heading</h4><pre><code>code block</code></pre><u>underlined</u>' +
        '<img src="https://example.com/x.png"><p><a href="javascript:alert(1)">bad</a>' +
        '<a href="mailto:a@example.com">mail</a><span style="color:red">red</span></p>' +
        '<table><tr><td>cell</td></tr></table><script>alert(1)</script>',
    );
    const json = e.getJSON();
    expect(JournalDocSchema.safeParse(json).success).toBe(true);
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/javascript:|mailto:|"type":"(image|codeBlock|underline|table)/);
    expect(text).not.toContain('"type":"link"');
  });

  it('renders doc headings under the page headings', () => {
    const e = open('<h1>Title</h1>');
    expect(e.getHTML()).toBe('<h3>Title</h3>');
  });
});

describe('normalizeJournalHref', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['  http://x.y/path?q=1 ', 'http://x.y/path?q=1'],
    ['javascript:alert(1)', null],
    ['mailto:a@b.c', null],
    ['', null],
  ])('%p → %p', (input, expected) => {
    expect(normalizeJournalHref(input)).toBe(expected);
  });
});
