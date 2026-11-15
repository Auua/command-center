import { describe, expect, it } from 'vitest';
import {
  APPRECIATION_LIST_MAX,
  AppreciationListLimitSchema,
  AppreciationPromptLocaleSchema,
  AppreciationPromptTodaySchema,
  CreateAppreciationRequestSchema,
} from './appreciation';

describe('CreateAppreciationRequestSchema', () => {
  it('trims the text and defaults tags to none', () => {
    expect(CreateAppreciationRequestSchema.parse({ text: '  The dog said hi  ' })).toEqual({
      text: 'The dog said hi',
      tags: [],
    });
  });

  it('accepts 1–280 characters and rejects blank or longer text', () => {
    expect(CreateAppreciationRequestSchema.safeParse({ text: 'x'.repeat(280) }).success).toBe(true);
    expect(CreateAppreciationRequestSchema.safeParse({ text: 'x'.repeat(281) }).success).toBe(
      false,
    );
    expect(CreateAppreciationRequestSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(CreateAppreciationRequestSchema.safeParse({}).success).toBe(false);
  });

  it('dedupes tags and enforces at most 5 of at most 24 characters', () => {
    expect(
      CreateAppreciationRequestSchema.parse({ text: 'ok', tags: [' walk ', 'walk', 'sun'] }).tags,
    ).toEqual(['walk', 'sun']);
    expect(
      CreateAppreciationRequestSchema.safeParse({
        text: 'ok',
        tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      }).success,
    ).toBe(false);
    expect(
      CreateAppreciationRequestSchema.safeParse({ text: 'ok', tags: ['x'.repeat(25)] }).success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(
      CreateAppreciationRequestSchema.safeParse({ text: 'ok', userId: 'someone-else' }).success,
    ).toBe(false);
  });
});

describe('AppreciationListLimitSchema', () => {
  it('defaults to 3 and accepts 1 to the maximum', () => {
    expect(AppreciationListLimitSchema.parse(undefined)).toBe(3);
    expect(AppreciationListLimitSchema.parse('12')).toBe(12);
    expect(AppreciationListLimitSchema.parse(String(APPRECIATION_LIST_MAX))).toBe(
      APPRECIATION_LIST_MAX,
    );
  });

  it('rejects zero, too many and non-integers', () => {
    for (const value of ['0', String(APPRECIATION_LIST_MAX + 1), '2.5', 'abc']) {
      expect(AppreciationListLimitSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('prompt schemas', () => {
  it('defaults the locale to English and refuses unknown locales', () => {
    expect(AppreciationPromptLocaleSchema.parse(undefined)).toBe('en');
    expect(AppreciationPromptLocaleSchema.parse('fi')).toBe('fi');
    expect(AppreciationPromptLocaleSchema.safeParse('de').success).toBe(false);
  });

  it('carries the local date the prompt belongs to', () => {
    const today = { id: 'smile', text: 'What made you smile today?', date: '2026-11-15' };
    expect(AppreciationPromptTodaySchema.parse(today)).toEqual(today);
    expect(AppreciationPromptTodaySchema.safeParse({ ...today, date: '15.11.2026' }).success).toBe(
      false,
    );
  });
});
