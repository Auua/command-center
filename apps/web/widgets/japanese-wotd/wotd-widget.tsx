'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactElement } from 'react';
import { z } from 'zod';
import {
  JLPT_LEVELS,
  type JlptLevel,
  type WotdConfiguredResponse,
  type WotdItem,
  type WotdResponse,
} from '@command-center/contracts';
import { useQuickAction, type WidgetProps } from '@command-center/ui';
import { AnkiSyncStatus } from '@/components/anki-sync-status';
import { StreakPill } from '@/components/streak-pill';
import { t } from '@/lib/i18n';
import { acknowledgeWotd, fetchWotd, skipWotd } from '@/lib/learning-api';
import { STREAKS_QUERY_KEY } from '@/lib/use-streaks';
import { checkIcon, skipIcon } from './icon';

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

function Chips({ item }: { item: WotdItem }): ReactElement {
  const detail = item.kind === 'verb' ? item.verbclass : item.pos;
  return (
    <p className="cc-wotd-chips">
      {item.jlpt && <span className="cc-wotd-chip">{item.jlpt}</span>}
      <span className="cc-wotd-chip cc-wotd-chip-muted">
        {t(item.kind === 'verb' ? 'wotd.kind.verb' : 'wotd.kind.vocab')}
        {detail ? ` · ${detail}` : ''}
      </span>
      <StreakPill streakKey="japanese-wotd" />
    </p>
  );
}

function Example({ item }: { item: WotdItem }): ReactElement {
  const example = item.examples[0];
  if (!example) {
    return <p className="cc-wotd-example cc-wotd-example-none">{t('wotd.noExample')}</p>;
  }
  return (
    <div className="cc-wotd-example">
      <p lang="ja">{example.ja}</p>
      {example.fi && <p className="cc-wotd-example-fi">{example.fi}</p>}
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

  const [announcements, setAnnouncements] = useState({ polite: '', alert: '' });
  const announce = useCallback((kind: 'polite' | 'alert', message: string): void => {
    setAnnouncements((current) =>
      kind === 'polite' ? { polite: message, alert: '' } : { ...current, alert: message },
    );
  }, []);

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
    onError: () => announce('alert', t('wotd.error.action')),
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
    onError: () => announce('alert', t('wotd.error.action')),
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
  if (wotdQuery.isPending) {
    body = (
      <div className="cc-wotd-skeleton" aria-hidden="true">
        <span className="cc-wotd-ghost cc-wotd-ghost-word" />
        <span className="cc-wotd-ghost" />
        <span className="cc-wotd-ghost cc-wotd-ghost-short" />
      </div>
    );
  } else if (wotdQuery.isError || !data) {
    body = (
      <div className="cc-wotd-state">
        <p className="cc-wotd-error">{t('wotd.error.load')}</p>
        <button type="button" className="cc-btn" onClick={() => void wotdQuery.refetch()}>
          {t('wotd.retry')}
        </button>
      </div>
    );
  } else if (!data.configured) {
    body = (
      <div className="cc-wotd-state">
        <p>{t('wotd.notConfigured')}</p>
        <p className="cc-wotd-hint">{t('wotd.notConfiguredHint')}</p>
      </div>
    );
  } else if (data.state === 'token-invalid') {
    body = (
      <div className="cc-wotd-state">
        <p className="cc-wotd-error">{t('wotd.tokenInvalid')}</p>
        <p className="cc-wotd-hint">{t('wotd.tokenInvalidHint')}</p>
      </div>
    );
  } else if (data.state === 'unavailable' || item === null) {
    body = (
      <div className="cc-wotd-state">
        <p>{data.exhausted ? t('wotd.exhausted') : t('wotd.unavailable')}</p>
        {!data.exhausted && (
          <button type="button" className="cc-btn" onClick={() => void wotdQuery.refetch()}>
            {t('wotd.retry')}
          </button>
        )}
      </div>
    );
  } else {
    const meaning = pickMeaning(item.meaning, meaningLanguage);
    body = (
      <article className="cc-wotd">
        <Chips item={item} />
        <Headword item={item} showFurigana={showFurigana} showRomaji={showRomaji} />
        {meaning.text ? (
          <p className="cc-wotd-meaning" lang={meaning.lang}>
            {meaning.text}
          </p>
        ) : (
          <p className="cc-wotd-meaning cc-wotd-hint">{t('wotd.noMeaning')}</p>
        )}
        <Example item={item} />
        <div className="cc-wotd-footer">
          {data.acknowledged ? (
            <p className="cc-wotd-done">
              <span aria-hidden="true">{checkIcon()}</span> {t('wotd.acknowledged.state')}
            </p>
          ) : (
            <>
              <button
                type="button"
                className="cc-btn cc-wotd-btn"
                onClick={acknowledge}
                disabled={busy}
                aria-busy={acknowledgeMutation.isPending}
              >
                <span aria-hidden="true">{checkIcon()}</span> {t('wotd.acknowledge')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn-ghost cc-wotd-btn"
                onClick={skip}
                disabled={busy}
                aria-busy={skipMutation.isPending}
              >
                <span aria-hidden="true">{skipIcon()}</span> {t('wotd.skip')}
              </button>
            </>
          )}
          <a
            className="cc-wotd-source"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('wotd.openNote')}
          </a>
          <AnkiSyncStatus />
        </div>
      </article>
    );
  }

  return (
    <div className="cc-wotd-root">
      <p className="cc-visually-hidden" role="status" aria-live="polite">
        {announcements.polite}
      </p>
      <p className="cc-visually-hidden" role="alert">
        {announcements.alert}
      </p>
      {body}
    </div>
  );
}
