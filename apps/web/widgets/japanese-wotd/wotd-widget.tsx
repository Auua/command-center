'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { z } from 'zod';
import {
  JLPT_LEVELS,
  type JlptLevel,
  type WotdConfiguredResponse,
  type WotdItem,
  type WotdResponse,
} from '@command-center/contracts';
import {
  Button,
  CheckIcon,
  Chip,
  ChipRow,
  DoneState,
  Hint,
  SkipIcon,
  SourceLink,
  useAnnouncer,
  useQuickAction,
  WidgetBody,
  WidgetFooter,
  type WidgetProps,
} from '@command-center/ui';
import { AnkiSyncStatus } from '@/components/anki-sync-status';
import { LearningState } from '@/components/learning-state';
import { StreakPill } from '@/components/streak-pill';
import { t } from '@/lib/i18n';
import { acknowledgeWotd, fetchWotd, skipWotd } from '@/lib/learning-api';
import { STREAKS_QUERY_KEY } from '@/lib/use-streaks';

export const wotdSettingsSchema = z.object({
  jlptCeiling: z.enum(JLPT_LEVELS).default('N5'),
  showFurigana: z.boolean().default(true),
  showRomaji: z.boolean().default(false),
  meaningLanguage: z.enum(['fi', 'en']).default('fi'),
});

export type WotdSettings = z.input<typeof wotdSettingsSchema>;

export const WOTD_QUERY_KEY = ['learning', 'wotd'];

const KANJI_RE = /[㐀-䶿一-鿿]/;

/** Kana-first reading practice: ruby only when the headword carries kanji. */
export function needsRuby(word: string, reading: string | null): reading is string {
  return reading !== null && reading !== '' && reading !== word && KANJI_RE.test(word);
}

/** FI-first vault: `en` is opt-in and falls back to `fi` (ADR-040). */
export function pickMeaning(
  meaning: WotdItem['meaning'],
  language: 'fi' | 'en',
): { text: string | null; lang: 'fi' | 'en' } {
  if (language === 'en' && meaning.en) return { text: meaning.en, lang: 'en' };
  if (meaning.fi) return { text: meaning.fi, lang: 'fi' };
  return meaning.en ? { text: meaning.en, lang: 'en' } : { text: null, lang: 'fi' };
}

function Headword({
  item,
  showFurigana,
  showRomaji,
}: {
  item: WotdItem;
  showFurigana: boolean;
  showRomaji: boolean;
}): ReactElement {
  const rtClass = showFurigana ? undefined : 'cc-visually-hidden';
  return (
    <div className="cc-wotd-head">
      <h3 className="cc-wotd-word" lang="ja">
        {needsRuby(item.word, item.reading) ? (
          <ruby>
            {item.word}
            <rp>(</rp>
            <rt className={rtClass}>{item.reading}</rt>
            <rp>)</rp>
          </ruby>
        ) : (
          item.word
        )}
      </h3>
      {showRomaji && item.romaji && <p className="cc-wotd-romaji">{item.romaji}</p>}
    </div>
  );
}

function Example({ item }: { item: WotdItem }): ReactElement {
  const example = item.examples[0];
  if (!example) return <Hint>{t('learning.noExample')}</Hint>;
  return (
    <div className="cc-example">
      <p lang="ja">{example.ja}</p>
      {example.fi && <p className="cc-example-fi">{example.fi}</p>}
    </div>
  );
}

/**
 * Word of the day (ADR-011 as amended by ADR-040): today's pinned vault note
 * with ruby furigana, FI-first meaning, one example, and the two deliberate
 * gestures — "Learned it" (acknowledge: writes progress to the note, credits
 * the streak) and "Already knew it" (skip: marks known, draws a replacement).
 */
export function WotdWidget({ settings }: WidgetProps<WotdSettings>): ReactElement {
  const queryClient = useQueryClient();
  const ceiling: JlptLevel = settings.jlptCeiling ?? 'N5';
  const showFurigana = settings.showFurigana ?? true;
  const showRomaji = settings.showRomaji ?? false;
  const meaningLanguage = settings.meaningLanguage ?? 'fi';
  const queryKey = [...WOTD_QUERY_KEY, ceiling];
  const { announce, regions } = useAnnouncer();

  const wotdQuery = useQuery({
    queryKey,
    queryFn: () => fetchWotd(ceiling),
    staleTime: 60_000,
  });

  const settle = (response: WotdResponse): void => {
    queryClient.setQueryData(queryKey, response);
  };

  const acknowledgeMutation = useMutation({
    mutationFn: (itemId: string) => acknowledgeWotd(itemId),
    onSuccess: (response) => {
      settle(response);
      void queryClient.invalidateQueries({ queryKey: STREAKS_QUERY_KEY });
      announce('polite', t('wotd.acknowledged.announce'));
    },
    onError: () => announce('alert', t('learning.error.action')),
  });

  const skipMutation = useMutation({
    mutationFn: (itemId: string) => skipWotd(itemId, ceiling),
    onSuccess: (response) => {
      settle(response);
      const next = response.configured ? response.item : null;
      announce(
        'polite',
        next ? t('wotd.skipped.announce', { word: next.word }) : t('wotd.exhausted'),
      );
    },
    onError: () => announce('alert', t('learning.error.action')),
  });

  const data = wotdQuery.data;
  const configured: WotdConfiguredResponse | null = data && data.configured ? data : null;
  const item = configured?.item ?? null;
  const busy = acknowledgeMutation.isPending || skipMutation.isPending;
  const canAct = item !== null && configured !== null && !configured.acknowledged && !busy;

  const acknowledge = (): void => {
    if (canAct && item) acknowledgeMutation.mutate(item.itemId);
  };
  const skip = (): void => {
    if (canAct && item) skipMutation.mutate(item.itemId);
  };
  useQuickAction('wotd-acknowledge', acknowledge);
  useQuickAction('wotd-skip', skip);

  let body: ReactElement;
  if (!configured || configured.state !== 'ok' || item === null) {
    body = (
      <LearningState
        query={wotdQuery}
        exhaustedText={t('wotd.exhausted')}
        errorText={t('wotd.error.load')}
      />
    );
  } else {
    const meaning = pickMeaning(item.meaning, meaningLanguage);
    const detail = item.kind === 'verb' ? item.verbclass : item.pos;
    body = (
      <WidgetBody>
        <ChipRow>
          {item.jlpt && <Chip>{item.jlpt}</Chip>}
          <Chip tone="muted">
            {t(item.kind === 'verb' ? 'wotd.kind.verb' : 'wotd.kind.vocab')}
            {detail ? ` · ${detail}` : ''}
          </Chip>
          <StreakPill streakKey="japanese-wotd" />
        </ChipRow>
        <Headword item={item} showFurigana={showFurigana} showRomaji={showRomaji} />
        {meaning.text ? (
          <p className="cc-meaning" lang={meaning.lang}>
            {meaning.text}
          </p>
        ) : (
          <Hint>{t('learning.noMeaning')}</Hint>
        )}
        <Example item={item} />
        <WidgetFooter>
          {configured.acknowledged ? (
            <DoneState>{t('wotd.acknowledged.state')}</DoneState>
          ) : (
            <>
              <Button
                icon={<CheckIcon />}
                onClick={acknowledge}
                disabled={busy}
                busy={acknowledgeMutation.isPending}
              >
                {t('wotd.acknowledge')}
              </Button>
              <Button
                variant="ghost"
                icon={<SkipIcon />}
                onClick={skip}
                disabled={busy}
                busy={skipMutation.isPending}
              >
                {t('wotd.skip')}
              </Button>
            </>
          )}
          <SourceLink href={item.sourceUrl}>{t('learning.openNote')}</SourceLink>
          <AnkiSyncStatus />
        </WidgetFooter>
      </WidgetBody>
    );
  }

  return (
    <div className="cc-body">
      {regions}
      {body}
    </div>
  );
}
