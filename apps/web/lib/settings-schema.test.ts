import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clampToDeclaredSize, describeSettingsSchema } from '@command-center/ui';

describe('describeSettingsSchema', () => {
  it('yields no fields for an empty object schema', () => {
    expect(describeSettingsSchema(z.object({}))).toEqual([]);
  });

  it('yields no fields for a non-object schema', () => {
    expect(describeSettingsSchema(z.string())).toEqual([]);
  });

  it('describes the shapes the widget ADRs use, in declaration order', () => {
    const schema = z.object({
      showFurigana: z.boolean().default(true),
      jlptCeiling: z.enum(['N5', 'N4', 'N3']).default('N5'),
      maxRows: z.number().int().min(1).max(20).default(6),
      label: z.string().optional(),
      tags: z.array(z.string().min(1)).max(12).default(['a', 'b']),
      visible: z.array(z.enum(['x', 'y'])).default([]),
      nested: z.object({ deep: z.boolean() }),
    });

    expect(describeSettingsSchema(schema)).toEqual([
      { kind: 'boolean', name: 'showFurigana', defaultValue: true },
      { kind: 'enum', name: 'jlptCeiling', options: ['N5', 'N4', 'N3'], defaultValue: 'N5' },
      { kind: 'number', name: 'maxRows', min: 1, max: 20, integer: true, defaultValue: 6 },
      { kind: 'string', name: 'label', defaultValue: undefined },
      { kind: 'string-list', name: 'tags', maxItems: 12, defaultValue: ['a', 'b'] },
      { kind: 'enum-list', name: 'visible', options: ['x', 'y'], defaultValue: [] },
      { kind: 'unsupported', name: 'nested' },
    ]);
  });
});

describe('clampToDeclaredSize', () => {
  const declared = [
    { w: 2, h: 1 },
    { w: 2, h: 2 },
    { w: 3, h: 2 },
  ];

  it('keeps an exactly declared size', () => {
    expect(clampToDeclaredSize({ w: 2, h: 2 }, declared)).toEqual({ w: 2, h: 2 });
  });

  it('snaps down to the largest declared size that fits', () => {
    expect(clampToDeclaredSize({ w: 4, h: 2 }, declared)).toEqual({ w: 3, h: 2 });
    expect(clampToDeclaredSize({ w: 2, h: 5 }, declared)).toEqual({ w: 2, h: 2 });
  });

  it('falls back to the smallest declared size when nothing fits', () => {
    expect(clampToDeclaredSize({ w: 1, h: 1 }, declared)).toEqual({ w: 2, h: 1 });
  });

  it('leaves the size alone when the widget declares none', () => {
    expect(clampToDeclaredSize({ w: 9, h: 9 }, [])).toEqual({ w: 9, h: 9 });
  });
});
