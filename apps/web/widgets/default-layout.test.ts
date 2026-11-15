import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, packLayout } from '@command-center/ui';
import { DEFAULT_LAYOUT } from './default-layout';
import { widgetRegistry } from './registry';

function cells(item: (typeof DEFAULT_LAYOUT)[number]): string[] {
  const out: string[] = [];
  for (let row = item.gridPos.y; row < item.gridPos.y + item.gridPos.h; row += 1) {
    for (let col = item.gridPos.x; col < item.gridPos.x + item.gridPos.w; col += 1) {
      out.push(`${col},${row}`);
    }
  }
  return out;
}

describe('DEFAULT_LAYOUT', () => {
  it('places every registered widget exactly once', () => {
    const ids = DEFAULT_LAYOUT.map((item) => item.widgetId);
    const registered = widgetRegistry.all().map((definition) => definition.id);
    expect([...ids].sort()).toEqual([...registered].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only sizes each widget declares', () => {
    for (const item of DEFAULT_LAYOUT) {
      const sizes = widgetRegistry.get(item.widgetId)?.sizes ?? [];
      expect(sizes, item.widgetId).toContainEqual({ w: item.gridPos.w, h: item.gridPos.h });
    }
  });

  it('has no overlapping placements and stays inside the grid', () => {
    const seen = new Set<string>();
    for (const item of DEFAULT_LAYOUT) {
      expect(item.gridPos.x + item.gridPos.w).toBeLessThanOrEqual(GRID_COLUMNS);
      for (const cell of cells(item)) {
        expect(seen.has(cell), `${item.widgetId} overlaps at ${cell}`).toBe(false);
        seen.add(cell);
      }
    }
  });

  it('is already packed (the editor saves it unchanged)', () => {
    expect(packLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });
});
