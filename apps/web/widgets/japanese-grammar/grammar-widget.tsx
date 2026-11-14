'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { z } from 'zod';
import {
  JLPT_LEVELS,
  type GrammarConfiguredResponse,
  type GrammarItem,
  type GrammarResponse,
  type JlptLevel,
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
import { advanceGrammar, fetchGrammarToday, studyGrammar } from '@/lib/learning-api';
import { STREAKS_QUERY_KEY } from '@/lib/use-streaks';
import { pickMeaning } from '../japanese-wotd/wotd-widget';

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
  if (examples.length === 0) return <Hint>{t('learning.noExample')}</Hint>;
  const showFi = reveal === 'always' || revealed;
  return (
    <div className="cc-examples">
      {examples.map((example) => (
        <div key={example.ja} className="cc-example">
          <p lang="ja">{example.ja}</p>
          {example.fi && showFi && <p className="cc-example-fi">{example.fi}</p>}
        </div>
      ))}
      {reveal === 'tap' && examples.some((example) => example.fi) && (
        <Button
          variant="link"
          size="sm"
          aria-expanded={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? t('grammar.hideTranslation') : t('grammar.showTranslation')}
        </Button>
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
  const { announce, regions } = useAnnouncer();

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
    onError: () => announce('alert', t('learning.error.action')),
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
    onError: () => announce('alert', t('learning.error.action')),
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
  if (!configured || configured.state !== 'ok' || item === null) {
    body = (
      <LearningState
        query={query}
        exhaustedText={t('grammar.exhausted')}
        errorText={t('grammar.error.load')}
      />
    );
  } else {
    const meaning = pickMeaning(item.meaning, meaningLanguage);
    body = (
      <WidgetBody>
        <ChipRow>
          {item.jlpt && <Chip>{item.jlpt}</Chip>}
          {configured.mode === 'review' && <Chip tone="muted">{t('grammar.review')}</Chip>}
          <span className="cc-hint">
            {t('grammar.progress', {
              level: ceiling,
              seen: configured.progress.seenAtLevel,
              total: configured.progress.totalAtLevel,
            })}
          </span>
          <StreakPill streakKey="japanese-grammar" />
        </ChipRow>
        <h3 className="cc-grammar-pattern" lang="ja">
          {item.ja}
        </h3>
        {showReading && item.reading && (
          <p className="cc-wotd-romaji" lang="ja">
            {item.reading}
          </p>
        )}
        {meaning.text ? (
          <p className="cc-meaning" lang={meaning.lang}>
            {meaning.text}
          </p>
        ) : (
          <Hint>{t('learning.noMeaning')}</Hint>
        )}
        {item.attaches.length > 0 && (
          <Hint>
            {t('grammar.attaches')} {item.attaches.join(' · ')}
          </Hint>
        )}
        <Examples item={item} count={exampleCount} reveal={reveal} />
        <WidgetFooter>
          {configured.studied ? (
            <DoneState>{t('grammar.studied.state')}</DoneState>
          ) : (
            <Button
              icon={<CheckIcon />}
              onClick={study}
              disabled={busy}
              busy={studyMutation.isPending}
            >
              {t('grammar.studied')}
            </Button>
          )}
          <Button
            variant="ghost"
            icon={<NextIcon />}
            onClick={advance}
            disabled={busy}
            busy={advanceMutation.isPending}
          >
            {t('grammar.next')}
          </Button>
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
