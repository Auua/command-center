import {
  jlptRank,
  type IndexRecord,
  type JlptLevel,
  type KanjiRecord,
} from '@command-center/contracts';
import { linkTarget } from '../index/index-cache.service';
import { withOverlay, type ProgressOverlay } from '../wotd/selection';

/**
 * Pure kanji selection (ADR-041): WOTD's eligibility over the kanji shard
 * — `status: new`, unreviewed, a character, JLPT at or below the ceiling —
 * plus the linked-words rule and the small normalisations the card needs.
 */

export const KANJI_SEED = 'kanji';

/** Linked words shown on the card. */
export const MAX_WORDS = 6;

export function isKanjiRecord(record: IndexRecord): record is KanjiRecord {
  return record.type === 'kanji';
}

export function isKanjiEligible(record: KanjiRecord, ceiling: JlptLevel): boolean {
  const rank = jlptRank(record.jlpt);
  return (
    record.status === 'new' &&
    (record.reviewed === null || record.reviewed === '') &&
    typeof record.kanji === 'string' &&
    record.kanji.length > 0 &&
    rank >= 0 &&
    rank <= jlptRank(ceiling)
  );
}

/** Path-sorted eligible list — the stable order the date hash indexes into. */
export function eligibleKanji(
  records: Iterable<IndexRecord>,
  overlayFor: (path: string) => ProgressOverlay | undefined,
  ceiling: JlptLevel,
): KanjiRecord[] {
  const out: KanjiRecord[] = [];
  for (const record of records) {
    if (!isKanjiRecord(record)) continue;
    const effective = withOverlay(record, overlayFor(record.path));
    if (isKanjiEligible(effective, ceiling)) out.push(effective);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `'2'` → 2; the vault's prose values (`N/A (jouyou, …)`) → null. */
export function normaliseGrade(grade: string | null | undefined): number | null {
  if (grade === null || grade === undefined) return null;
  const match = /^\s*([1-6])\s*$/.exec(grade);
  return match ? Number(match[1]) : null;
}

/** `[[人]]` → `人` for component / look-alike chips. */
export function linkCharacters(links: readonly string[]): string[] {
  return links.map(linkTarget).filter((value) => value.length > 0);
}

/** A word record as the card lists it, after the overlay. */
export interface LinkedWordRecord {
  path: string;
  word: string;
  reading: string | null;
  meaning: { fi: string | null; en: string | null };
  jlpt: string | null;
  status: string | null;
}

function statusRank(status: string | null): number {
  // Anchors first: words the user already has some grip on.
  switch (status) {
    case 'known':
      return 0;
    case 'learning':
      return 1;
    case 'shaky':
      return 2;
    default:
      return 3;
  }
}

/**
 * Words linking the kanji, anchors first (progress ≠ new), then JLPT
 * ascending, then path; capped at MAX_WORDS (ADR-041).
 */
export function orderLinkedWords(
  words: readonly LinkedWordRecord[],
  limit = MAX_WORDS,
): LinkedWordRecord[] {
  return [...words]
    .sort((a, b) => {
      const byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus !== 0) return byStatus;
      const rankA = jlptRank(a.jlpt);
      const rankB = jlptRank(b.jlpt);
      const byJlpt = (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB);
      if (byJlpt !== 0) return byJlpt;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    })
    .slice(0, limit);
}
