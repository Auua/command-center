'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type ReactElement } from 'react';
import { z } from 'zod';
import {
  JLPT_LEVELS,
  type GrammarConfiguredResponse,
  type GrammarItem,
  type GrammarResponse,
  type JlptLevel,
} from '@command-center/contracts';
import { useQuickAction, type WidgetProps } from '@command-center/ui';
import { AnkiSyncStatus } from '@/components/anki-sync-status';
import { StreakPill } from '@/components/streak-pill';
import { t } from '@/lib/i18n';
import { advanceGrammar, fetchGrammarToday, studyGrammar } from '@/lib/learning-api';
import { STREAKS_QUERY_KEY } from '@/lib/use-streaks';
import { pickMeaning } from '../japanese-wotd/wotd-widget';
import { checkIcon, nextIcon } from './icon';

export const grammarSettingsSchema = z.object({
  jlptCeiling: z.enum(JLPT_LEVELS).default('N5'),
  showReading: z.boolean().default(false),
  revealTranslation: z.enum(['always', 'tap']).default('always'),
  meaningLanguage: z.enum(['fi', 'en']).default('fi'),
});

export type GrammarSettings = z.input<typeof grammarSettingsSchema>;

export const GRAMMAR_QUERY_KEY = ['learning', 'grammar'];

function Examples({
  item,
  count,
  reveal,
}: {
  item: GrammarItem;
  count: number;
  reveal: 'always' | 'tap';
}): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const examples = item.examples.slice(0, count);
  if (examples.length === 0) {
    return <p className="cc-grammar-example cc-grammar-hint">{t('grammar.noExample')}</p>;
  }
  const showFi = reveal === 'always' || revealed;
  return (
    <div className="cc-grammar-examples">
      {examples.map((example) => (
        <div key={example.ja} className="cc-grammar-example">
          <p lang="ja">{example.ja}</p>
          {example.fi && showFi && <p className="cc-grammar-example-fi">{example.fi}</p>}
        </div>
      ))}
      {reveal === 'tap' && examples.some((example) => example.fi) && (
        <button
          type="button"
          className="cc-btn cc-btn-ghost cc-grammar-reveal"
          aria-expanded={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? t('grammar.hideTranslation') : t('grammar.showTranslation')}
        </button>
      )}
    </div>
  );
}

/**
 * Grammar point of the day (ADR-012 as amended by ADR-040): the next point
 * in the textbook's teaching order under the JLPT ceiling, review rotation
 * once exhausted. "Mark studied" is the deliberate gesture that credits the
 * streak; "Next point" only stamps the point as seen.
 */
export function GrammarWidget({ settings, size }: WidgetProps<GrammarSettings>): ReactElement {
  const queryClient = useQueryClient();
  const ceiling: JlptLevel = settings.jlptCeiling ?? 'N5';
  const showReading = settings.showReading ?? false;
  const reveal = settings.revealTranslation ?? 'always';
  const meaningLanguage = settings.meaningLanguage ?? 'fi';
  const queryKey = [...GRAMMAR_QUERY_KEY, ceiling];
  const exampleCount = size.h >= 3 ? 2 : 1;

  const [announcements, setAnnouncements] = useState({ polite: '', alert: '' });
  const announce = useCallback((kind: 'polite' | 'alert', message: string): void => {
    setAnnouncements((current) =>
      kind === 'polite' ? { polite: message, alert: '' } : { ...current, alert: message },
    );
  }, []);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchGrammarToday(ceiling),
    staleTime: 60_000,
  });

  const settle = (response: GrammarResponse): void => {
    queryClient.setQueryData(queryKey, response);
  };

  const studyMutation = useMutation({
    mutationFn: (itemId: string) => studyGrammar(itemId, ceiling),
    onSuccess: (response) => {
      settle(response);
      void queryClient.invalidateQueries({ queryKey: STREAKS_QUERY_KEY });
      announce('polite', t('grammar.studied.announce'));
    },
    onError: () => announce('alert', t('grammar.error.action')),
  });

  const advanceMutation = useMutation({
    mutationFn: (itemId: string) => advanceGrammar(itemId, ceiling),
    onSuccess: (response) => {
      settle(response);
      const next = response.configured ? response.item : null;
      announce(
        'polite',
        next ? t('grammar.advanced.announce', { pattern: next.ja }) : t('grammar.exhausted'),
      );
    },
    onError: () => announce('alert', t('grammar.error.action')),
  });

  const data = query.data;
  const configured: GrammarConfiguredResponse | null = data && data.configured ? data : null;
  const item = configured?.item ?? null;
  const busy = studyMutation.isPending || advanceMutation.isPending;
  const canAct = item !== null && configured !== null && !busy;

  const study = (): void => {
    if (canAct && item && !configured?.studied) studyMutation.mutate(item.itemId);
  };
  const advance = (): void => {
    if (canAct && item) advanceMutation.mutate(item.itemId);
  };
  useQuickAction('grammar-studied', study);
  useQuickAction('grammar-advance', advance);

  let body: ReactElement;
  if (query.isPending) {
    body = (
      <div className="cc-wotd-skeleton" aria-hidden="true">
        <span className="cc-wotd-ghost cc-wotd-ghost-word" />
        <span className="cc-wotd-ghost" />
        <span className="cc-wotd-ghost cc-wotd-ghost-short" />
      </div>
    );
  } else if (query.isError || !data) {
    body = (
      <div className="cc-wotd-state">
        <p className="cc-wotd-error">{t('grammar.error.load')}</p>
        <button type="button" className="cc-btn" onClick={() => void query.refetch()}>
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
        <p>{data.exhausted ? t('grammar.exhausted') : t('wotd.unavailable')}</p>
        {!data.exhausted && (
          <button type="button" className="cc-btn" onClick={() => void query.refetch()}>
            {t('wotd.retry')}
          </button>
        )}
      </div>
    );
  } else {
    const meaning = pickMeaning(item.meaning, meaningLanguage);
    body = (
      <article className="cc-grammar">
        <p className="cc-wotd-chips">
          {item.jlpt && <span className="cc-wotd-chip">{item.jlpt}</span>}
          {data.mode === 'review' && (
            <span className="cc-wotd-chip cc-wotd-chip-muted">{t('grammar.review')}</span>
          )}
          <span className="cc-grammar-progress">
            {t('grammar.progress', {
              level: ceiling,
              seen: data.progress.seenAtLevel,
              total: data.progress.totalAtLevel,
            })}
          </span>
          <StreakPill streakKey="japanese-grammar" />
        </p>
        <h3 className="cc-grammar-pattern" lang="ja">
          {item.ja}
        </h3>
        {showReading && item.reading && <p className="cc-wotd-romaji">{item.reading}</p>}
        {meaning.text ? (
          <p className="cc-grammar-meaning" lang={meaning.lang}>
            {meaning.text}
          </p>
        ) : (
          <p className="cc-grammar-meaning cc-wotd-hint">{t('wotd.noMeaning')}</p>
        )}
        {item.attaches.length > 0 && (
          <p className="cc-grammar-attaches">
            {t('grammar.attaches')} {item.attaches.join(' · ')}
          </p>
        )}
        <Examples item={item} count={exampleCount} reveal={reveal} />
        <div className="cc-wotd-footer">
          {data.studied ? (
            <p className="cc-wotd-done">
              <span aria-hidden="true">{checkIcon()}</span> {t('grammar.studied.state')}
            </p>
          ) : (
            <button
              type="button"
              className="cc-btn cc-wotd-btn"
              onClick={study}
              disabled={busy}
              aria-busy={studyMutation.isPending}
            >
              <span aria-hidden="true">{checkIcon()}</span> {t('grammar.studied')}
            </button>
          )}
          <button
            type="button"
            className="cc-btn cc-btn-ghost cc-wotd-btn"
            onClick={advance}
            disabled={busy}
            aria-busy={advanceMutation.isPending}
          >
            <span aria-hidden="true">{nextIcon()}</span> {t('grammar.next')}
          </button>
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
