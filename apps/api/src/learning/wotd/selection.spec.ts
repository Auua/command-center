import type { IndexRecord, VocabRecord } from '@command-center/contracts';
import { decidePin, eligibleWotd, pickForDate, pickReplacement } from './selection';

function vocab(path: string, overrides: Partial<VocabRecord> = {}): VocabRecord {
  return {
    path,
    type: 'vocab',
    jlpt: 'N5',
    status: 'new',
    confidence: 1,
    reviewed: null,
    created: '2026-08-29',
    sources: [],
    source: null,
    tags: [],
    meaning: { fi: 'x', en: null },
    examples: [],
    cards: 1,
    word: path,
    reading: null,
    romaji: null,
    pos: null,
    kanji: [],
    sets: [],
    ...overrides,
  };
}

const noOverlay = (): undefined => undefined;

describe('eligibleWotd', () => {
  it('keeps new, unreviewed vocab/verb notes at or below the ceiling, path-sorted', () => {
    const records: IndexRecord[] = [
      vocab('b.md'),
      vocab('a.md'),
      vocab('n3.md', { jlpt: 'N3' }),
      vocab('known.md', { status: 'known' }),
      vocab('reviewed.md', { reviewed: '2026-09-01' }),
      vocab('nolevel.md', { jlpt: null }),
      { ...vocab('grammar.md'), type: 'grammar' } as unknown as IndexRecord,
    ];
    expect(eligibleWotd(records, noOverlay, 'N5').map((r) => r.path)).toEqual(['a.md', 'b.md']);
    expect(eligibleWotd(records, noOverlay, 'N3').map((r) => r.path)).toEqual([
      'a.md',
      'b.md',
      'n3.md',
    ]);
  });

  it('applies the overlay so a just-acknowledged word drops out before the index catches up', () => {
    const records = [vocab('a.md'), vocab('b.md')];
    const overlay = (
      path: string,
    ): { status: string; reviewed: string; confidence: number } | undefined =>
      path === 'a.md' ? { status: 'learning', reviewed: '2026-09-18', confidence: 2 } : undefined;
    expect(eligibleWotd(records, overlay, 'N5').map((r) => r.path)).toEqual(['b.md']);
  });
});

describe('pickForDate', () => {
  const eligible = ['a', 'b', 'c', 'd', 'e'].map((p) => vocab(`${p}.md`));

  it('is deterministic for a date and changes across dates', () => {
    const first = pickForDate(eligible, '2026-09-18');
    expect(pickForDate(eligible, '2026-09-18')).toBe(first);
    const picks = new Set(
      ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'].map(
        (date) => pickForDate(eligible, date)?.path,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('returns null on an empty list', () => {
    expect(pickForDate([], '2026-09-18')).toBeNull();
  });
});

describe('decidePin', () => {
  const eligible = ['a', 'b', 'c'].map((p) => vocab(`${p}.md`));
  const exists = (path: string): boolean => path !== 'gone.md';

  it('draws and writes a fresh pin when there is none', () => {
    const decision = decidePin(undefined, '2026-09-18', eligible, exists);
    expect(decision.write).toBe(true);
    expect(decision.pin).toEqual({
      date: '2026-09-18',
      itemId: expect.any(String),
      resolved: false,
    });
  });

  it('carries an unresolved, still-eligible pin over to later days', () => {
    const pin = { date: '2026-09-10', itemId: 'b.md', resolved: false };
    expect(decidePin(pin, '2026-09-18', eligible, exists)).toEqual({
      pin,
      write: false,
      exhausted: false,
    });
  });

  it('keeps a resolved pin for the rest of its own day', () => {
    const pin = { date: '2026-09-18', itemId: 'b.md', resolved: true };
    expect(decidePin(pin, '2026-09-18', eligible, exists).pin).toBe(pin);
  });

  it('draws a new pin the day after a resolved one', () => {
    const pin = { date: '2026-09-17', itemId: 'b.md', resolved: true };
    const decision = decidePin(pin, '2026-09-18', eligible, exists);
    expect(decision.write).toBe(true);
    expect(decision.pin?.date).toBe('2026-09-18');
  });

  it('treats a pin whose note was hand-resolved in Obsidian as resolved', () => {
    const pin = { date: '2026-09-10', itemId: 'b.md', resolved: false };
    const decision = decidePin(pin, '2026-09-18', [vocab('a.md')], exists);
    expect(decision.write).toBe(true);
    expect(decision.pin?.itemId).toBe('a.md');
  });

  it('repins when the pinned note no longer exists (renamed)', () => {
    const pin = { date: '2026-09-18', itemId: 'gone.md', resolved: false };
    expect(decidePin(pin, '2026-09-18', eligible, exists).write).toBe(true);
  });

  it('reports exhaustion with no eligible notes and no carry-over', () => {
    expect(decidePin(undefined, '2026-09-18', [], exists)).toEqual({
      pin: null,
      write: false,
      exhausted: true,
    });
  });
});

describe('pickReplacement', () => {
  it('never returns the skipped note', () => {
    const eligible = ['a', 'b'].map((p) => vocab(`${p}.md`));
    for (const date of ['2026-09-18', '2026-09-19', '2026-09-20']) {
      expect(pickReplacement(eligible, 'a.md', date)?.path).toBe('b.md');
    }
    expect(pickReplacement([vocab('a.md')], 'a.md', '2026-09-18')).toBeNull();
  });
});
