'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { z } from 'zod';
import {
  JLPT_LEVELS,
  type JlptLevel,
  type KanjiConfiguredResponse,
  type KanjiItem,
  type KanjiResponse,
} from '@command-center/contracts';
import {
  Button,
  CheckIcon,
  Chip,
  ChipRow,
  DoneState,
  Hint,
  NextIcon,
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
import { acknowledgeKanji, fetchKanji, skipKanji } from '@/lib/learning-api';
import { STREAKS_QUERY_KEY } from '@/lib/use-streaks';
import { needsRuby } from '../japanese-wotd/wotd-widget';

export const kanjiSettingsSchema = z.object({
  jlptCeiling: z.enum(JLPT_LEVELS).default('N5'),
  showComponents: z.boolean().default(true),
  showExampleWords: z.boolean().default(true),
});

export type KanjiSettings = z.input<typeof kanjiSettingsSchema>;

export const KANJI_QUERY_KEY = ['learning', 'kanji'];

/**
 * `た.べる` → stem + muted okurigana. One text node for assistive tech: the
 * split is presentational, so the full reading is still read as a whole.
 */
export function Kunyomi({ reading }: { reading: string }): ReactElement {
  const dot = reading.indexOf('.');
  if (dot <= 0 || dot === reading.length - 1) return <>{reading}</>;
  return (
    <>
      {reading.slice(0, dot)}
      <span className="cc-kanji-okurigana">{reading.slice(dot + 1)}</span>
    </>
  );
}

function Readings({ item }: { item: KanjiItem }): ReactElement | null {
  if (item.onyomi.length === 0 && item.kunyomi.length === 0) return null;
  return (
    <dl className="cc-kanji-readings">
      {item.onyomi.length > 0 && (
        <div className="cc-kanji-reading-row">
          <dt>{t('kanji.onyomi')}</dt>
          <dd lang="ja">{item.onyomi.join('・')}</dd>
        </div>
      )}
      {item.kunyomi.length > 0 && (
        <div className="cc-kanji-reading-row">
          <dt>{t('kanji.kunyomi')}</dt>
          <dd lang="ja">
            {item.kunyomi.map((reading, index) => (
              <span key={reading}>
                {index > 0 && '・'}
                <Kunyomi reading={reading} />
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}

function Related({ item }: { item: KanjiItem }): ReactElement | null {
  if (item.components.length === 0 && item.lookalikes.length === 0) return null;
  return (
    <div className="cc-kanji-related">
      {item.components.length > 0 && (
        <ChipRow>
          <span className="cc-hint">{t('kanji.components')}</span>
          {item.components.map((character) => (
            <Chip key={character} tone="muted" lang="ja">
              {character}
            </Chip>
          ))}
        </ChipRow>
      )}
      {item.lookalikes.length > 0 && (
        <ChipRow>
          <span className="cc-hint">{t('kanji.lookalikes')}</span>
          {item.lookalikes.map((character) => (
            <Chip key={character} tone="muted" lang="ja">
              {character}
            </Chip>
          ))}
        </ChipRow>
      )}
    </div>
  );
}

function Words({ item, limit }: { item: KanjiItem; limit: number }): ReactElement {
  const words = item.words.slice(0, limit);
  if (words.length === 0) return <Hint>{t('kanji.noWords')}</Hint>;
  return (
    <ul className="cc-kanji-words">
      {words.map((word) => (
        <li key={word.itemId} className="cc-kanji-word">
          <span className="cc-kanji-word-ja" lang="ja">
            {needsRuby(word.word, word.reading) ? (
              <ruby>
                {word.word}
                <rp>(</rp>
                <rt>{word.reading}</rt>
                <rp>)</rp>
              </ruby>
            ) : (
              word.word
            )}
          </span>
          {word.meaning.fi && (
            <span className="cc-kanji-word-fi" lang="fi">
              {word.meaning.fi}
            </span>
          )}
          {word.jlpt && <Chip tone="muted">{word.jlpt}</Chip>}
          {word.status && word.status !== 'new' && (
            <span
              className={`cc-kanji-word-dot cc-kanji-word-dot-${word.status}`}
              role="img"
              aria-label={t('kanji.wordStatus', { status: word.status })}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Kanji of the day (ADR-041): today's pinned kanji note — the character
 * large, meaning, readings, components and look-alikes, the mnemonic when
 * the index carries it, and the words that use it — with WOTD's two
 * gestures: "Learned it" credits the streak, "Already knew it" retires it.
 */
export function KanjiWidget({ settings, size }: WidgetProps<KanjiSettings>): ReactElement {
  const queryClient = useQueryClient();
  const ceiling: JlptLevel = settings.jlptCeiling ?? 'N5';
  const showComponents = settings.showComponents ?? true;
  const showExampleWords = settings.showExampleWords ?? true;
  const queryKey = [...KANJI_QUERY_KEY, ceiling];
  const wordLimit = size.h >= 3 ? 6 : 3;
  const { announce, regions } = useAnnouncer();

  const query = useQuery({
    queryKey,
    queryFn: () => fetchKanji(ceiling),
    staleTime: 60_000,
  });

  const settle = (response: KanjiResponse): void => {
    queryClient.setQueryData(queryKey, response);
  };

  const acknowledgeMutation = useMutation({
    mutationFn: (itemId: string) => acknowledgeKanji(itemId),
    onSuccess: (response) => {
      settle(response);
      void queryClient.invalidateQueries({ queryKey: STREAKS_QUERY_KEY });
      announce('polite', t('kanji.acknowledged.announce'));
    },
    onError: () => announce('alert', t('learning.error.action')),
  });

  const skipMutation = useMutation({
    mutationFn: (itemId: string) => skipKanji(itemId, ceiling),
    onSuccess: (response) => {
      settle(response);
      const next = response.configured ? response.item : null;
      announce(
        'polite',
        next ? t('kanji.skipped.announce', { kanji: next.kanji }) : t('kanji.exhausted'),
      );
    },
    onError: () => announce('alert', t('learning.error.action')),
  });

  const data = query.data;
  const configured: KanjiConfiguredResponse | null = data && data.configured ? data : null;
  const item = configured?.item ?? null;
  const busy = acknowledgeMutation.isPending || skipMutation.isPending;
  const canAct = item !== null && configured !== null && !configured.acknowledged && !busy;

  const acknowledge = (): void => {
    if (canAct && item) acknowledgeMutation.mutate(item.itemId);
  };
  const skip = (): void => {
    if (canAct && item) skipMutation.mutate(item.itemId);
  };
  useQuickAction('kanji-acknowledge', acknowledge);
  useQuickAction('kanji-skip', skip);

  let body: ReactElement;
  if (!configured || configured.state !== 'ok' || item === null) {
    body = (
      <LearningState
        query={query}
        exhaustedText={t('kanji.exhausted')}
        errorText={t('kanji.error.load')}
      />
    );
  } else {
    body = (
      <WidgetBody>
        <ChipRow>
          {item.jlpt && <Chip>{item.jlpt}</Chip>}
          {item.grade !== null && (
            <Chip tone="muted">{t('kanji.grade', { grade: item.grade })}</Chip>
          )}
          {item.strokes !== null && (
            <Chip tone="muted">{t('kanji.strokes', { count: item.strokes })}</Chip>
          )}
          <StreakPill streakKey="japanese-kanji" />
        </ChipRow>
        <div className="cc-kanji-head">
          <h3 className="cc-kanji-glyph" lang="ja">
            {item.kanji}
          </h3>
          <div className="cc-kanji-head-text">
            {item.meaning.fi ? (
              <p className="cc-meaning" lang="fi">
                {item.meaning.fi}
              </p>
            ) : (
              <Hint>{t('learning.noMeaning')}</Hint>
            )}
            <Readings item={item} />
          </div>
        </div>
        {showComponents && <Related item={item} />}
        {item.mnemonic && (
          <blockquote className="cc-kanji-mnemonic" lang="fi">
            {item.mnemonic}
          </blockquote>
        )}
        {showExampleWords && <Words item={item} limit={wordLimit} />}
        <WidgetFooter>
          {configured.acknowledged ? (
            <DoneState>{t('kanji.acknowledged.state')}</DoneState>
          ) : (
            <>
              <Button
                icon={<CheckIcon />}
                title={t('kanji.acknowledge.hint')}
                onClick={acknowledge}
                disabled={busy}
                busy={acknowledgeMutation.isPending}
              >
                {t('kanji.acknowledge')}
              </Button>
              <Button
                variant="ghost"
                icon={<NextIcon />}
                title={t('kanji.skip.hint')}
                onClick={skip}
                disabled={busy}
                busy={skipMutation.isPending}
              >
                {t('kanji.skip')}
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
