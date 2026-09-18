import {
  jlptRank,
  type DayPin,
  type GrammarRecord,
  type IndexRecord,
  type JlptLevel,
} from '@command-center/contracts';
import { withOverlay, type ProgressOverlay } from '../wotd/selection';

/**
 * Pure grammar selection (ADR-012 as amended by ADR-040): sequenced, not
 * hash-random. Order = `jlpt` ascending, then the first `sources` link's
 * book and chapter (the textbook's teaching order), then `created`, then
 * path. When nothing new is left under the ceiling the service switches to
 * review mode: the point with the oldest `reviewed` date.
 */

export function isGrammarRecord(record: IndexRecord): record is GrammarRecord {
  return record.type === 'grammar';
}

function compareNullable<T extends string | number>(a: T | null, b: T | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareTeachingOrder(a: GrammarRecord, b: GrammarRecord): number {
  return (
    jlptRank(a.jlpt) - jlptRank(b.jlpt) ||
    compareNullable(a.source?.book ?? null, b.source?.book ?? null) ||
    compareNullable(a.source?.chapter ?? null, b.source?.chapter ?? null) ||
    compareNullable(a.created, b.created) ||
    compareNullable(a.path, b.path)
  );
}

function underCeiling(record: GrammarRecord, ceiling: JlptLevel): boolean {
  const rank = jlptRank(record.jlpt);
  return (
    rank >= 0 && rank <= jlptRank(ceiling) && typeof record.ja === 'string' && record.ja !== ''
  );
}

function hasProgress(record: GrammarRecord): boolean {
  return record.status !== 'new' || (record.reviewed !== null && record.reviewed !== '');
}

function effective(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): GrammarRecord[] {
  const out: GrammarRecord[] = [];
  for (const record of records) {
    if (!isGrammarRecord(record)) continue;
    const merged = withOverlay(record, overlayFor(record.path));
    if (underCeiling(merged, ceiling)) out.push(merged);
  }
  return out;
}

/** Unseen points under the ceiling, in teaching order. */
export function eligibleGrammar(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): GrammarRecord[] {
  return effective(records, overlayFor, ceiling)
    .filter((record) => !hasProgress(record))
    .sort(compareTeachingOrder);
}

/** Seen points under the ceiling, oldest `reviewed` first (spaced re-exposure, no SRS math). */
export function reviewCandidates(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): GrammarRecord[] {
  return effective(records, overlayFor, ceiling)
    .filter(hasProgress)
    .sort(
      (a, b) =>
        compareNullable(a.reviewed || null, b.reviewed || null) || compareTeachingOrder(a, b),
    );
}

export function progressAtLevel(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): { seenAtLevel: number; totalAtLevel: number } {
  const all = effective(records, overlayFor, ceiling);
  return { seenAtLevel: all.filter(hasProgress).length, totalAtLevel: all.length };
}

export interface GrammarPinDecision {
  pin: DayPin | null;
  write: boolean;
  exhausted: boolean;
  mode: 'new' | 'review';
}

/**
 * Carry-over as for WOTD: an unresolved pin whose note still exists is
 * served on any later day; a resolved pin holds for the rest of its day;
 * otherwise the next point in sequence, or the oldest reviewed one.
 */
export function decideGrammarPin(
  current: DayPin | undefined,
  utcDate: string,
  eligible: readonly GrammarRecord[],
  review: readonly GrammarRecord[],
  exists: (path: string) => boolean,
  exclude?: string,
): GrammarPinDecision {
  if (current && exists(current.itemId) && (!current.resolved || current.date === utcDate)) {
    return { pin: current, write: false, exhausted: false, mode: current.mode ?? 'new' };
  }
  const next = eligible.find((record) => record.path !== exclude);
  if (next) {
    return {
      pin: { date: utcDate, itemId: next.path, resolved: false, mode: 'new' },
      write: true,
      exhausted: false,
      mode: 'new',
    };
  }
  const again = review.find((record) => record.path !== exclude);
  if (again) {
    return {
      pin: { date: utcDate, itemId: again.path, resolved: false, mode: 'review' },
      write: true,
      exhausted: false,
      mode: 'review',
    };
  }
  return { pin: null, write: false, exhausted: true, mode: 'new' };
}
