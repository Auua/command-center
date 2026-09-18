import type { GrammarRecord } from '@command-center/contracts';
import { decideGrammarPin, eligibleGrammar, progressAtLevel, reviewCandidates } from './selection';

function grammar(path: string, overrides: Partial<GrammarRecord> = {}): GrammarRecord {
  return {
    path,
    type: 'grammar',
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
    ja: path,
    reading: null,
    func: [],
    attaches: [],
    formality: null,
    register: [],
    similar: [],
    compare: null,
    ...overrides,
  };
}

const noOverlay = (): undefined => undefined;

describe('eligibleGrammar', () => {
  it('orders by JLPT, then book, then chapter, then created, with no-source notes last per level', () => {
    const records = [
      grammar('n4-first.md', { jlpt: 'N4', source: { book: 'Minna I', chapter: 1 } }),
      grammar('mnn-20.md', { source: { book: 'Minna I', chapter: 20 } }),
      grammar('mnn-3.md', { source: { book: 'Minna I', chapter: 3 } }),
      grammar('nosource-b.md', { created: '2026-09-02' }),
      grammar('nosource-a.md', { created: '2026-09-01' }),
      grammar('genki-1.md', { source: { book: 'Genki', chapter: 1 } }),
    ];
    expect(eligibleGrammar(records, noOverlay, 'N4').map((r) => r.path)).toEqual([
      'genki-1.md',
      'mnn-3.md',
      'mnn-20.md',
      'nosource-a.md',
      'nosource-b.md',
      'n4-first.md',
    ]);
  });

  it('drops seen points, points above the ceiling, and honours the overlay', () => {
    const records = [
      grammar('a.md'),
      grammar('seen.md', { status: 'learning' }),
      grammar('reviewed.md', { reviewed: '2026-09-01' }),
      grammar('n3.md', { jlpt: 'N3' }),
    ];
    const overlay = (
      path: string,
    ): { status: string; reviewed: string; confidence: number } | undefined =>
      path === 'a.md' ? { status: 'learning', reviewed: '2026-09-18', confidence: 2 } : undefined;
    expect(eligibleGrammar(records, noOverlay, 'N5').map((r) => r.path)).toEqual(['a.md']);
    expect(eligibleGrammar(records, overlay, 'N5')).toEqual([]);
  });
});

describe('reviewCandidates / progressAtLevel', () => {
  const records = [
    grammar('new.md'),
    grammar('old.md', { reviewed: '2026-08-01', status: 'learning' }),
    grammar('recent.md', { reviewed: '2026-09-10', status: 'shaky' }),
    grammar('known.md', { status: 'known' }),
  ];

  it('returns seen points oldest-reviewed first, never-reviewed ones last', () => {
    expect(reviewCandidates(records, noOverlay, 'N5').map((r) => r.path)).toEqual([
      'old.md',
      'recent.md',
      'known.md',
    ]);
  });

  it('counts progress under the ceiling', () => {
    expect(progressAtLevel(records, noOverlay, 'N5')).toEqual({ seenAtLevel: 3, totalAtLevel: 4 });
  });
});

describe('decideGrammarPin', () => {
  const eligible = [grammar('a.md'), grammar('b.md')];
  const review = [grammar('old.md', { reviewed: '2026-08-01' })];
  const exists = (): boolean => true;

  it('pins the first point in sequence when there is no pin', () => {
    expect(decideGrammarPin(undefined, '2026-09-18', eligible, review, exists)).toEqual({
      pin: { date: '2026-09-18', itemId: 'a.md', resolved: false, mode: 'new' },
      write: true,
      exhausted: false,
      mode: 'new',
    });
  });

  it('carries an unresolved pin over and keeps a resolved pin for its day', () => {
    const open = { date: '2026-09-10', itemId: 'b.md', resolved: false, mode: 'new' as const };
    expect(decideGrammarPin(open, '2026-09-18', eligible, review, exists).pin).toBe(open);
    const done = { date: '2026-09-18', itemId: 'b.md', resolved: true, mode: 'new' as const };
    expect(decideGrammarPin(done, '2026-09-18', eligible, review, exists).pin).toBe(done);
  });

  it('skips the excluded point (advance) and falls back to review mode when the sequence is empty', () => {
    expect(
      decideGrammarPin(undefined, '2026-09-18', eligible, review, exists, 'a.md').pin?.itemId,
    ).toBe('b.md');
    const decision = decideGrammarPin(undefined, '2026-09-18', [], review, exists);
    expect(decision.mode).toBe('review');
    expect(decision.pin?.itemId).toBe('old.md');
  });

  it('reports exhaustion when neither sequence nor review has anything', () => {
    expect(decideGrammarPin(undefined, '2026-09-18', [], [], exists).exhausted).toBe(true);
  });
});
