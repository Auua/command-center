import { z } from 'zod';

/**
 * Introspection of a widget's zod `settingsSchema` into a flat field list the
 * auto-generated settings panel renders (ADR §4.2). Supports the shapes the
 * widget ADRs use: boolean, enum, number, string, string[] and enum[] —
 * each optionally wrapped in `.default()` / `.optional()`. Anything else is
 * reported as `unsupported` so the panel can say so instead of guessing.
 */
export type SettingsField =
  | { kind: 'boolean'; name: string; defaultValue: boolean | undefined }
  | { kind: 'enum'; name: string; options: readonly string[]; defaultValue: string | undefined }
  | {
      kind: 'number';
      name: string;
      min: number | undefined;
      max: number | undefined;
      integer: boolean;
      defaultValue: number | undefined;
    }
  | { kind: 'string'; name: string; defaultValue: string | undefined }
  | {
      kind: 'string-list';
      name: string;
      maxItems: number | undefined;
      defaultValue: string[] | undefined;
    }
  | {
      kind: 'enum-list';
      name: string;
      options: readonly string[];
      defaultValue: string[] | undefined;
    }
  | { kind: 'unsupported'; name: string };

interface Unwrapped {
  inner: z.ZodTypeAny;
  defaultValue: unknown;
}

function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let inner = schema;
  let defaultValue: unknown;
  // Peel .default() / .optional() / .nullable() in any order.
  for (;;) {
    if (inner instanceof z.ZodDefault) {
      defaultValue = (inner._def.defaultValue as () => unknown)();
      inner = inner._def.innerType as z.ZodTypeAny;
    } else if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
      inner = inner._def.innerType as z.ZodTypeAny;
    } else {
      return { inner, defaultValue };
    }
  }
}

function numberBounds(schema: z.ZodNumber): { min?: number; max?: number; integer: boolean } {
  let min: number | undefined;
  let max: number | undefined;
  let integer = false;
  for (const check of schema._def.checks) {
    if (check.kind === 'min') min = check.value;
    else if (check.kind === 'max') max = check.value;
    else if (check.kind === 'int') integer = true;
  }
  return { min, max, integer };
}

function describeOne(name: string, schema: z.ZodTypeAny): SettingsField {
  const { inner, defaultValue } = unwrap(schema);

  if (inner instanceof z.ZodBoolean) {
    return { kind: 'boolean', name, defaultValue: defaultValue as boolean | undefined };
  }
  if (inner instanceof z.ZodEnum) {
    return {
      kind: 'enum',
      name,
      options: inner.options as readonly string[],
      defaultValue: defaultValue as string | undefined,
    };
  }
  if (inner instanceof z.ZodNumber) {
    const { min, max, integer } = numberBounds(inner);
    return {
      kind: 'number',
      name,
      min,
      max,
      integer,
      defaultValue: defaultValue as number | undefined,
    };
  }
  if (inner instanceof z.ZodString) {
    return { kind: 'string', name, defaultValue: defaultValue as string | undefined };
  }
  if (inner instanceof z.ZodArray) {
    const element = unwrap(inner.element as z.ZodTypeAny).inner;
    if (element instanceof z.ZodEnum) {
      return {
        kind: 'enum-list',
        name,
        options: element.options as readonly string[],
        defaultValue: defaultValue as string[] | undefined,
      };
    }
    if (element instanceof z.ZodString) {
      const maxItems = inner._def.maxLength?.value;
      return {
        kind: 'string-list',
        name,
        maxItems,
        defaultValue: defaultValue as string[] | undefined,
      };
    }
  }
  return { kind: 'unsupported', name };
}

/**
 * Flat field descriptors for a widget settings schema, in declaration order.
 * A schema that is not a `z.object` (or an empty one) yields no fields — the
 * shell then shows no settings affordance for that widget.
 */
export function describeSettingsSchema(schema: z.ZodTypeAny): SettingsField[] {
  const { inner } = unwrap(schema);
  if (!(inner instanceof z.ZodObject)) return [];
  const shape = inner.shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape).map(([name, field]) => describeOne(name, field));
}
