import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, moveItem, orderOfLayout, packLayout } from '@command-center/ui';

interface Item {
  id: string;
  gridPos: { x: number; y: number; w: number; h: number };
}

function item(id: string, w: number, h: number, x = 0, y = 0): Item {
  return { id, gridPos: { x, y, w, h } };
}

/** id → "x,y" for compact assertions. */
function positions(items: Item[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.id, `${i.gridPos.x},${i.gridPos.y}`]));
}

describe('packLayout', () => {
  it('uses a 6-column grid by default', () => {
    expect(GRID_COLUMNS).toBe(6);
  });

  it('places mixed sizes left to right, top to bottom, in list order', () => {
    const packed = packLayout([
      item('clock', 2, 1),
      item('braindump', 2, 2),
      item('mood', 2, 2),
      item('tasks', 2, 2),
      item('reminders', 4, 2),
    ]);
    expect(positions(packed)).toEqual({
      clock: '0,0',
      braindump: '2,0',
      mood: '4,0',
      // Under the 1-row clock: the first cell after mood's where 2×2 fits.
      tasks: '0,1',
      reminders: '2,2',
    });
    expect(packed.map((i) => i.id)).toEqual(['clock', 'braindump', 'mood', 'tasks', 'reminders']);
  });

  it('leaves a hole when a card does not fit the rest of the row, and never back-fills it', () => {
    const packed = packLayout([
      item('a', 4, 1),
      item('b', 3, 1), // does not fit the 2 cells left in row 0 → row 1
      item('c', 2, 1), // would fit the hole at (4,0) but must not go back there
      item('d', 1, 1),
    ]);
    expect(positions(packed)).toEqual({ a: '0,0', b: '0,1', c: '3,1', d: '5,1' });
  });

  it('skips cells taken by taller earlier cards', () => {
    const packed = packLayout([item('tall', 2, 3), item('wide', 4, 1), item('next', 4, 1)]);
    expect(positions(packed)).toEqual({ tall: '0,0', wide: '2,0', next: '2,1' });
  });

  it('clamps a footprint wider than the grid to the grid width', () => {
    const packed = packLayout([item('small', 2, 1), item('huge', 9, 2)]);
    expect(packed[1]?.gridPos).toEqual({ x: 0, y: 1, w: 6, h: 2 });
    expect(packLayout([item('x', 5, 1)], 3)[0]?.gridPos).toEqual({ x: 0, y: 0, w: 3, h: 1 });
  });

  it('keeps w/h and ignores the incoming x/y', () => {
    const packed = packLayout([item('a', 3, 2, 3, 7)]);
    expect(packed[0]?.gridPos).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('is idempotent', () => {
    const once = packLayout([
      item('a', 2, 1),
      item('b', 3, 2),
      item('c', 4, 1),
      item('d', 2, 3),
      item('e', 1, 1),
    ]);
    expect(packLayout(once)).toEqual(once);
  });

  it('does not mutate its input and keeps other fields', () => {
    const input = [item('a', 2, 2, 4, 4), item('b', 2, 2, 0, 0)];
    const snapshot = structuredClone(input);
    const packed = packLayout(input);
    expect(input).toEqual(snapshot);
    expect(packed[0]).not.toBe(input[0]);
    expect(packed[0]?.id).toBe('a');
  });

  it('packs an empty list to an empty list', () => {
    expect(packLayout([])).toEqual([]);
  });
});

describe('orderOfLayout', () => {
  it('reads a hand-placed layout in (y, x) order', () => {
    // The pre-ADR-042 default layout, in its stored (non-reading) order.
    const stored = [
      item('clock', 2, 1, 0, 0),
      item('braindump', 2, 2, 2, 0),
      item('tasks', 2, 2, 0, 1),
      item('mood', 2, 2, 4, 0),
      item('reminders', 4, 2, 2, 2),
      item('japanese-wotd', 2, 2, 0, 3),
      item('japanese-grammar', 3, 2, 2, 4),
      item('streaks', 2, 2, 0, 5),
    ];
    expect(orderOfLayout(stored).map((i) => i.id)).toEqual([
      'clock',
      'braindump',
      'mood',
      'tasks',
      'reminders',
      'japanese-wotd',
      'japanese-grammar',
      'streaks',
    ]);
  });

  it('is stable for equal positions and does not mutate', () => {
    const input = [item('b', 1, 1, 0, 1), item('a1', 1, 1, 0, 0), item('a2', 1, 1, 0, 0)];
    const result = orderOfLayout(input);
    expect(result.map((i) => i.id)).toEqual(['a1', 'a2', 'b']);
    expect(input.map((i) => i.id)).toEqual(['b', 'a1', 'a2']);
  });
});

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an element later and earlier', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is a no-op (new array, same order) out of range', () => {
    for (const [from, to] of [
      [-1, 0],
      [0, 4],
      [4, 0],
      [1, 1],
    ] as const) {
      const result = moveItem(list, from, to);
      expect(result).toEqual(list);
      expect(result).not.toBe(list);
    }
  });
});
