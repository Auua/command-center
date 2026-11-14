import type { IndexRecord, KanjiRecord } from '@command-center/contracts';
import { decidePin, pickForDate } from '../wotd/selection';
import {
  eligibleKanji,
  KANJI_SEED,
  linkCharacters,
  normaliseGrade,
  orderLinkedWords,
} from './selection';

function kanji(path: string, overrides: Partial<KanjiRecord> = {}): KanjiRecord {
  return {
    path,
    type: 'kanji',
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
    cards: 7,
    kanji: path.slice(-4, -3),
    strokes: 9,
    grade: null,
    onyomi: ['ショク'],
    kunyomi: ['た.べる'],
    components: [],
    lookalikes: [],
    ...overrides,
  };
}

const noOverlay = (): undefined => undefined;

describe('eligibleKanji', () => {
  it('keeps new, unreviewed kanji at or below the ceiling and ignores other kinds', () => {
    const records: IndexRecord[] = [
      kanji('b/食.md'),
      kanji('a/飲.md'),
      kanji('n3/練.md', { jlpt: 'N3' }),
      kanji('known/一.md', { status: 'known' }),
      kanji('shaky/二.md', { status: 'shaky' }),
      kanji('reviewed/三.md', { reviewed: '2026-11-01' }),
      kanji('blank/四.md', { kanji: '' }),
      { ...kanji('vocab/x.md'), type: 'vocab' } as unknown as IndexRecord,
    ];
    expect(eligibleKanji(records, noOverlay, 'N4').map((record) => record.path)).toEqual([
      'a/飲.md',
      'b/食.md',
    ]);
    expect(eligibleKanji(records, noOverlay, 'N3')).toHaveLength(3);
  });

  it('applies the API overlay before eligibility', () => {
    const records = [kanji('a/食.md')];
    const overlay = (): { status: string; reviewed: string; confidence: number } => ({
      status: 'learning',
      reviewed: '2026-11-14',
      confidence: 2,
    });
    expect(eligibleKanji(records, overlay, 'N5')).toEqual([]);
  });
});

describe('kind-seeded pick', () => {
  it('draws a different item than WOTD would from the same list and date', () => {
    const eligible = Array.from({ length: 50 }, (_, index) =>
      kanji(`k/${String(index).padStart(2, '0')}字.md`),
    );
    const dates = ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'];
    const differs = dates.some(
      (date) => pickForDate(eligible, date, KANJI_SEED) !== pickForDate(eligible, date),
    );
    expect(differs).toBe(true);
    expect(pickForDate(eligible, '2026-11-14', KANJI_SEED)).toBe(
      pickForDate(eligible, '2026-11-14', KANJI_SEED),
    );
  });

  it('pins with the kanji seed and carries an unresolved pin over', () => {
    const eligible = [kanji('a/食.md'), kanji('b/飲.md')];
    const first = decidePin(undefined, '2026-11-14', eligible, () => true, KANJI_SEED);
    expect(first.write).toBe(true);
    expect(first.pin?.itemId).toBe(pickForDate(eligible, '2026-11-14', KANJI_SEED)?.path);
    const later = decidePin(first.pin ?? undefined, '2026-11-20', eligible, () => true, KANJI_SEED);
    expect(later).toEqual({ pin: first.pin, write: false, exhausted: false });
  });
});

describe('normaliseGrade / linkCharacters', () => {
  it('keeps school grades 1–6 and drops the vault prose', () => {
    expect(normaliseGrade('2')).toBe(2);
    expect(normaliseGrade(' 6 ')).toBe(6);
    expect(normaliseGrade('N/A (jouyou, ei perusasteen kanji)')).toBeNull();
    expect(normaliseGrade(null)).toBeNull();
    expect(normaliseGrade('7')).toBeNull();
  });

  it('strips wikilink brackets and aliases', () => {
    expect(linkCharacters(['[[人]]', '[[良|hyvä]]', '飲', '[[]]'])).toEqual(['人', '良', '飲']);
  });
});

describe('orderLinkedWords', () => {
  const word = (
    path: string,
    status: string | null,
    jlpt: string | null,
  ): Parameters<typeof orderLinkedWords>[0][number] => ({
    path,
    word: path,
    reading: null,
    meaning: { fi: null, en: null },
    jlpt,
    status,
  });

  it('puts anchors first, then JLPT ascending, then path, and caps the list', () => {
    const ordered = orderLinkedWords(
      [
        word('f', 'new', 'N5'),
        word('e', 'new', 'N4'),
        word('d', 'shaky', 'N2'),
        word('c', 'learning', 'N1'),
        word('b', 'known', 'N3'),
        word('a', 'new', null),
        word('g', 'new', 'N5'),
      ],
      6,
    );
    expect(ordered.map((entry) => entry.path)).toEqual(['b', 'c', 'd', 'f', 'g', 'e']);
  });
});
