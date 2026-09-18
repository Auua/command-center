import { applyProgress, readProgress } from './front-matter';

const INLINE = `---
type: vocab
word: ～目
reading: ~め
meaning: "järjestysluku-loppuliite (kolmas, neljäs...)"
jlpt: N5
sources: ["[[Minna no Nihongo I#Luku 23]]"]
status: new
confidence: 1
reviewed:
created: 2026-08-29
tags: [vocab, jlpt/n5]
---

## Merkitys
- **FI:** järjestysluku-loppuliite
- **EN:** suffix indicating order

## Kortit
#flashcards/vocab
～目::~め — järjestysluku-loppuliite
`;

const MULTILINE = `---
type: vocab
word: いっしょに
sets:
  - "[[Setti — Harrastukset ja vapaa-aika]]"
status: new
confidence: 1
reviewed:
created: 2026-08-30
tags:
  - vocab
  - jlpt/n5
---
body line
`;

const NO_REVIEWED = `---
type: verb
word: かける
status: new
confidence: 1
created: 2026-08-29
---
## Taivutus
| Muoto | Myönteinen |
`;

function body(text: string): string {
  const end = text.indexOf('\n---', 3);
  return text.slice(end);
}

describe('readProgress', () => {
  it('reads the three keys, treating an empty value as null', () => {
    expect(readProgress(INLINE)).toEqual({ status: 'new', confidence: 1, reviewed: null });
  });

  it('reports nulls for a note without front-matter', () => {
    expect(readProgress('# just a body')).toEqual({
      status: null,
      confidence: null,
      reviewed: null,
    });
  });
});

describe('applyProgress', () => {
  it('rewrites only the three known lines and keeps the body byte-identical', () => {
    const out = applyProgress(INLINE, {
      status: 'learning',
      confidence: 2,
      reviewed: '2026-09-18',
    });
    expect(out).toContain('\nstatus: learning\n');
    expect(out).toContain('\nconfidence: 2\n');
    expect(out).toContain('\nreviewed: 2026-09-18\n');
    expect(body(out)).toBe(body(INLINE));
    // Every other front-matter line is untouched, including quoting.
    expect(out).toContain('meaning: "järjestysluku-loppuliite (kolmas, neljäs...)"');
    expect(out.split('\n').length).toBe(INLINE.split('\n').length);
  });

  it('handles multi-line list front-matter without disturbing the lists', () => {
    const out = applyProgress(MULTILINE, { status: 'known', reviewed: '2026-09-18' });
    expect(out).toContain('sets:\n  - "[[Setti — Harrastukset ja vapaa-aika]]"\nstatus: known\n');
    expect(out).toContain('tags:\n  - vocab\n  - jlpt/n5\n---\nbody line');
    expect(out).toContain('\nreviewed: 2026-09-18\n');
  });

  it('appends a missing key right after status, in canonical order', () => {
    const out = applyProgress(NO_REVIEWED, { status: 'learning', reviewed: '2026-09-18' });
    expect(out).toContain('status: learning\nreviewed: 2026-09-18\nconfidence: 1\n');
    expect(body(out)).toBe(body(NO_REVIEWED));
  });

  it('is a no-op for an empty patch', () => {
    expect(applyProgress(INLINE, {})).toBe(INLINE);
  });

  it('throws on a note without front-matter', () => {
    expect(() => applyProgress('# body only', { status: 'learning' })).toThrow(/front-matter/);
  });

  it('round-trips: readProgress sees what applyProgress wrote', () => {
    const out = applyProgress(INLINE, {
      status: 'learning',
      confidence: 3,
      reviewed: '2026-09-18',
    });
    expect(readProgress(out)).toEqual({
      status: 'learning',
      confidence: 3,
      reviewed: '2026-09-18',
    });
  });
});
