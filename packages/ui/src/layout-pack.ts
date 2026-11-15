/**
 * Ordered-layout packing (ADR-042). A layout is an ordered list of
 * placements; each card's grid cell is derived from that order by
 * `packLayout`, so reading order, focus order and list order agree.
 * Pure and dependency-free: shared by the editor preview, the default
 * layout and the save path.
 */

/**
 * Reference column count: the width stored coordinates and the default
 * layout are packed at. What the dashboard shows is packed again at the
 * column count that fits the screen (`columnsForWidth`) — positions are
 * derived from the order, so any width gives the same order.
 */
export const GRID_COLUMNS = 6;

/** Fewest columns above the one-column phone layout: the widest declared size is 4. */
export const MIN_GRID_COLUMNS = 4;
/** Most columns on very wide screens; beyond this the columns just widen. */
export const MAX_GRID_COLUMNS = 12;
/** Narrowest a column gets before the grid drops one, in px. */
export const GRID_COLUMN_MIN_WIDTH = 160;

/**
 * How many columns fit a grid of `width` px with `gap` px between columns:
 * as many as keep each column at least `minColumnWidth` wide, rounded down
 * to an even number and clamped to [MIN_GRID_COLUMNS, MAX_GRID_COLUMNS].
 * Even, because almost every declared width is 2 or 4: an odd count leaves
 * a one-column strip empty at the end of most rows. An unknown width (not
 * measured yet, no layout engine) answers the reference GRID_COLUMNS.
 */
export function columnsForWidth(
  width: number,
  gap: number,
  minColumnWidth: number = GRID_COLUMN_MIN_WIDTH,
): number {
  if (!Number.isFinite(width) || width <= 0) return GRID_COLUMNS;
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const fit = Math.floor((width + safeGap) / (minColumnWidth + safeGap));
  const even = fit - (fit % 2);
  return Math.min(MAX_GRID_COLUMNS, Math.max(MIN_GRID_COLUMNS, even));
}

/** A placement's footprint: `x`/`y` derived by packing, `w`/`h` chosen. */
export interface PackGridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Anything with a grid position — a layout item, whatever else it carries. */
export interface PackableItem {
  gridPos: PackGridPos;
}

/**
 * Place the items in list order. Each goes to the first cell — rows top to
 * bottom, columns left to right — at or after the previous placement's cell
 * where its `w × h` footprint fits without overlapping earlier placements.
 * The scan never goes back to fill an earlier hole (CSS grid's default
 * row auto-flow, not `dense`). A footprint wider than the grid is clamped to
 * the grid width; `w`/`h` below 1 count as 1. Returns new items; the input
 * is not mutated, and packing a packed list changes nothing.
 */
export function packLayout<T extends PackableItem>(
  items: readonly T[],
  columns: number = GRID_COLUMNS,
): T[] {
  const width = Math.max(1, Math.floor(columns));
  // occupied[row][col]; rows are added on demand.
  const occupied: boolean[][] = [];
  const isFree = (row: number, col: number): boolean => !occupied[row]?.[col];

  const fits = (x: number, y: number, w: number, h: number): boolean => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (!isFree(row, col)) return false;
      }
    }
    return true;
  };

  const occupy = (x: number, y: number, w: number, h: number): void => {
    for (let row = y; row < y + h; row += 1) {
      const cells = (occupied[row] ??= new Array<boolean>(width).fill(false));
      for (let col = x; col < x + w; col += 1) cells[col] = true;
    }
  };

  // The auto-placement cursor: the previous placement's cell.
  let cursorRow = 0;
  let cursorCol = 0;

  return items.map((item) => {
    const w = Math.min(Math.max(Math.floor(item.gridPos.w), 1), width);
    const h = Math.max(Math.floor(item.gridPos.h), 1);

    let row = cursorRow;
    let col = cursorCol;
    // Terminates: a row below every occupied one always fits (w <= width).
    while (col + w > width || !fits(col, row, w, h)) {
      col += 1;
      if (col + w > width) {
        row += 1;
        col = 0;
      }
    }

    occupy(col, row, w, h);
    cursorRow = row;
    cursorCol = col;
    return { ...item, gridPos: { ...item.gridPos, x: col, y: row, w, h } };
  });
}

/**
 * The reading order of a stored (possibly hand-placed) layout: a stable
 * sort by `(y, x)`. Returns a new array.
 */
export function orderOfLayout<T extends PackableItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.gridPos.y - b.gridPos.y || a.gridPos.x - b.gridPos.x);
}

/**
 * Move the element at `from` to index `to` — the one reorder primitive
 * (buttons today, drag-and-drop later). Out-of-range indices are a no-op.
 * Always returns a new array.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const inRange = (index: number): boolean =>
    Number.isInteger(index) && index >= 0 && index < items.length;
  if (!inRange(from) || !inRange(to) || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
