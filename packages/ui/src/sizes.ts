import type { WidgetSize } from './widget';

/**
 * Snap a stored footprint to one the widget declares (ADR §4.2: `sizes` is
 * the contract, not a hint). An exact match is kept; otherwise the largest
 * declared size that fits inside the stored one wins; if none fits, the
 * smallest declared size. An empty declaration list leaves the size alone.
 */
export function clampToDeclaredSize(size: WidgetSize, declared: WidgetSize[]): WidgetSize {
  if (declared.length === 0) return size;
  if (declared.some((candidate) => candidate.w === size.w && candidate.h === size.h)) return size;

  const area = (candidate: WidgetSize): number => candidate.w * candidate.h;
  const fitting = declared.filter((candidate) => candidate.w <= size.w && candidate.h <= size.h);
  const pool = fitting.length > 0 ? fitting : declared;
  const pick = fitting.length > 0 ? Math.max : Math.min;
  const target = pick(...pool.map(area));
  // Deterministic tie-break: first declared size with the chosen area.
  return pool.find((candidate) => area(candidate) === target) ?? size;
}
