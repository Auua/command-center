import { createHash } from 'node:crypto';
import {
  jlptRank,
  type DayPin,
  type IndexRecord,
  type JlptLevel,
  type VerbRecord,
  type VocabRecord,
} from '@command-center/contracts';

/**
 * Pure WOTD selection (ADR-011 as amended by ADR-040). Eligible = vault notes
 * of type vocab/verb with `status: new`, no `reviewed` date, and a JLPT level
 * at or below the widget's ceiling. The pick is a date-seeded hash over the
 * path-sorted eligible list, so two API instances (or a retry) converge on
 * the same word for the same UTC day.
 */

export type WotdRecord = VocabRecord | VerbRecord;

/** Progress the API wrote since the index was generated (ADR-040 overlay). */
export interface ProgressOverlay {
  status: string | null;
  reviewed: string | null;
  confidence: number | null;
}

export function isWotdRecord(record: IndexRecord): record is WotdRecord {
  return record.type === 'vocab' || record.type === 'verb';
}

export function withOverlay<T extends IndexRecord>(
  record: T,
  overlay: ProgressOverlay | undefined,
): T {
  if (!overlay) return record;
  return {
    ...record,
    status: overlay.status ?? record.status,
    reviewed: overlay.reviewed ?? record.reviewed,
    confidence: overlay.confidence ?? record.confidence,
  };
}

export function isEligible(record: WotdRecord, ceiling: JlptLevel): boolean {
  const rank = jlptRank(record.jlpt);
  return (
    record.status === 'new' &&
    (record.reviewed === null || record.reviewed === '') &&
    typeof record.word === 'string' &&
    record.word.length > 0 &&
    rank >= 0 &&
    rank <= jlptRank(ceiling)
  );
}

/** Path-sorted eligible list — the stable order the hash indexes into. */
export function eligibleWotd(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): WotdRecord[] {
  const out: WotdRecord[] = [];
  for (const record of records) {
    if (!isWotdRecord(record)) continue;
    const effective = withOverlay(record, overlayFor(record.path));
    if (isEligible(effective, ceiling)) out.push(effective);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Date-seeded pick: sha256(`${date}|wotd`) mod n over the sorted list. */
export function pickForDate(eligible: readonly WotdRecord[], utcDate: string): WotdRecord | null {
  if (eligible.length === 0) return null;
  const digest = createHash('sha256').update(`${utcDate}|wotd`).digest();
  const seed = digest.readUInt32BE(0);
  return eligible[seed % eligible.length] ?? null;
}

export interface PinDecision {
  /** The pin to serve (and to write when `write` is true). Null = exhausted. */
  pin: DayPin | null;
  write: boolean;
  exhausted: boolean;
}

/**
 * Carry-over rule: an unresolved pin whose note is still eligible is served
 * on any later day; a pin made today is served even if resolved; otherwise
 * a fresh pick is drawn for today. A pin whose note disappeared (renamed) or
 * was resolved by hand in Obsidian counts as resolved.
 */
export function decidePin(
  current: DayPin | undefined,
  utcDate: string,
  eligible: readonly WotdRecord[],
  exists: (path: string) => boolean,
): PinDecision {
  const eligiblePaths = new Set(eligible.map((record) => record.path));
  if (current && exists(current.itemId)) {
    const carriesOver = !current.resolved && eligiblePaths.has(current.itemId);
    if (carriesOver || current.date === utcDate) {
      return { pin: current, write: false, exhausted: false };
    }
  }
  const pick = pickForDate(eligible, utcDate);
  if (!pick) return { pin: null, write: false, exhausted: true };
  return {
    pin: { date: utcDate, itemId: pick.path, resolved: false },
    write: true,
    exhausted: false,
  };
}

/** Next pick after a skip: today's hash over the remaining eligible list. */
export function pickReplacement(
  eligible: readonly WotdRecord[],
  skippedPath: string,
  utcDate: string,
): WotdRecord | null {
  return pickForDate(
    eligible.filter((record) => record.path !== skippedPath),
    utcDate,
  );
}
