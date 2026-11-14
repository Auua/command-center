import { describe, expect, it } from 'vitest';
import {
  IndexManifestSchema,
  IndexRecordSchema,
  jlptRank,
  KanjiResponseSchema,
  LearningStateFileSchema,
  WotdActionRequestSchema,
  WotdCeilingSchema,
  WotdResponseSchema,
} from './learning';

const vocabLine = {
  path: 'Japanese/30 Sanasto/Sanat/～目 (jarjestysluku).md',
  type: 'vocab',
  jlpt: 'N5',
  status: 'new',
  confidence: 1,
  reviewed: null,
  created: '2026-08-29',
  sources: ['[[Minna no Nihongo I#Luku 23]]'],
  source: { book: 'Minna no Nihongo I', chapter: 23 },
  tags: ['vocab', 'jlpt/n5'],
  meaning: { fi: 'järjestysluku-loppuliite', en: 'suffix indicating order' },
  examples: [{ ja: '3つ目です。', fi: 'Se on kolmas.', ref: 'Lausepankki — Silloin kun#^toki5' }],
  cards: 1,
  word: '～目',
  reading: '~め',
  romaji: '~me',
  pos: 'suffix',
  kanji: [],
  sets: [],
  pitch: [],
};

describe('jlptRank', () => {
  it('orders N5 first and N1 last, case-insensitively', () => {
    expect(jlptRank('N5')).toBe(0);
    expect(jlptRank('n1')).toBe(4);
    expect(jlptRank(null)).toBe(-1);
    expect(jlptRank('N6')).toBe(-1);
  });
});

describe('IndexRecordSchema', () => {
  it('parses a vocab line as the indexer writes it, keeping extra fields', () => {
    const parsed = IndexRecordSchema.parse(vocabLine);
    expect(parsed.type).toBe('vocab');
    expect((parsed as Record<string, unknown>).pitch).toEqual([]);
  });

  it('parses the other kinds by their discriminator', () => {
    expect(
      IndexRecordSchema.parse({
        ...vocabLine,
        type: 'kanji',
        kanji: '練',
        strokes: 14,
        grade: null,
        onyomi: ['レン'],
        kunyomi: ['ね-る'],
        components: [],
        lookalikes: [],
      }).type,
    ).toBe('kanji');
    // `mnemonic` is additive (ADR-041): absent today, a string once the indexer emits it.
    const withMnemonic = IndexRecordSchema.parse({
      ...vocabLine,
      type: 'kanji',
      kanji: '練',
      strokes: 14,
      grade: null,
      onyomi: ['レン'],
      kunyomi: ['ね-る'],
      components: [],
      lookalikes: [],
      mnemonic: 'Silkkilanka kiertyy itäpuolella.',
    });
    expect(withMnemonic.type === 'kanji' && withMnemonic.mnemonic).toBe(
      'Silkkilanka kiertyy itäpuolella.',
    );
    expect(
      IndexRecordSchema.parse({
        ...vocabLine,
        type: 'grammar',
        ja: '～と',
        func: ['ehto'],
        attaches: ['[[Sanakirjamuoto]]'],
        formality: 'neutral',
        register: ['puhuttu'],
        similar: [],
        compare: null,
      }).type,
    ).toBe('grammar');
  });

  it('rejects a line without a path', () => {
    expect(IndexRecordSchema.safeParse({ ...vocabLine, path: '' }).success).toBe(false);
  });
});

describe('IndexManifestSchema', () => {
  it('parses the manifest the indexer writes', () => {
    const manifest = IndexManifestSchema.parse({
      schemaVersion: 1,
      generatedAt: '2026-09-18T16:28:45Z',
      sha: '333ebb5127ae02f5e067fc45f853aa12d1430202',
      counts: { vocab: 7862, verb: 1459, kanji: 1109, grammar: 316 },
      skipped: { vocab: 96, verb: 0, kanji: 2, grammar: 0 },
      shards: { vocab: ['vocab.000.jsonl'], verb: ['verb.jsonl'] },
      errors: ['Japanese/x.md: missing jlpt'],
    });
    expect(manifest.shards.vocab).toEqual(['vocab.000.jsonl']);
  });

  it('rejects an unknown schema version', () => {
    expect(
      IndexManifestSchema.safeParse({
        schemaVersion: 2,
        generatedAt: 'x',
        sha: null,
        counts: {},
        skipped: {},
        shards: {},
        errors: [],
      }).success,
    ).toBe(false);
  });
});

describe('LearningStateFileSchema', () => {
  it('parses day pins per kind', () => {
    const state = LearningStateFileSchema.parse({
      schemaVersion: 1,
      kinds: { wotd: { date: '2026-09-18', itemId: 'Japanese/x.md', resolved: false } },
    });
    expect(state.kinds.wotd?.resolved).toBe(false);
  });
});

describe('WotdResponseSchema', () => {
  it('accepts the unconfigured shape', () => {
    expect(WotdResponseSchema.parse({ configured: false })).toEqual({ configured: false });
  });

  it('accepts an ok response with a null item when exhausted', () => {
    const parsed = WotdResponseSchema.parse({
      configured: true,
      state: 'ok',
      date: '2026-09-18',
      item: null,
      acknowledged: false,
      exhausted: true,
      index: { sha: null, generatedAt: null },
    });
    expect(parsed.configured).toBe(true);
  });
});

describe('WotdActionRequestSchema / WotdCeilingSchema', () => {
  it('requires an itemId and nothing else', () => {
    expect(WotdActionRequestSchema.safeParse({}).success).toBe(false);
    expect(WotdActionRequestSchema.safeParse({ itemId: 'a.md', extra: 1 }).success).toBe(false);
  });

  it('defaults the ceiling to N5 and rejects unknown levels', () => {
    expect(WotdCeilingSchema.parse(undefined)).toBe('N5');
    expect(WotdCeilingSchema.safeParse('N6').success).toBe(false);
  });
});

describe('KanjiResponseSchema', () => {
  it('accepts an ok response with linked words and a null mnemonic', () => {
    const parsed = KanjiResponseSchema.parse({
      configured: true,
      state: 'ok',
      date: '2026-11-14',
      item: {
        itemId: 'Japanese/40 Kanji/Merkit/食.md',
        kanji: '食',
        strokes: 9,
        grade: 2,
        jlpt: 'N5',
        onyomi: ['ショク', 'ジキ'],
        kunyomi: ['た.べる', 'く.う'],
        meaning: { fi: 'syödä, ruoka', en: null },
        components: ['人', '良'],
        lookalikes: ['飲'],
        mnemonic: null,
        words: [
          {
            itemId: 'Japanese/20 Verbit/Lekseemit/食べる.md',
            word: '食べる',
            reading: 'たべる',
            meaning: { fi: 'syödä', en: null },
            jlpt: 'N5',
            status: 'known',
          },
        ],
        status: 'new',
        confidence: 1,
        sourceUrl: 'https://github.com/x/y/blob/main/z.md',
      },
      acknowledged: false,
      exhausted: false,
      index: { sha: 'abc', generatedAt: '2026-10-23T08:59:23Z' },
    });
    expect(parsed.configured && parsed.item?.words[0]?.word).toBe('食べる');
  });

  it('rejects a kanji item without a character', () => {
    expect(
      KanjiResponseSchema.safeParse({
        configured: true,
        state: 'ok',
        date: '2026-11-14',
        item: { itemId: 'x.md', kanji: '' },
        acknowledged: false,
        exhausted: false,
        index: { sha: null, generatedAt: null },
      }).success,
    ).toBe(false);
  });
});
