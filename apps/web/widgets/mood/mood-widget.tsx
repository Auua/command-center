'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { z } from 'zod';
import type { MoodCheckin, MoodScore } from '@command-center/contracts';
import {
  Button,
  ErrorText,
  RetryIcon,
  Skeleton,
  WidgetBody,
  WidgetMessage,
  type WidgetProps,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { createMoodCheckin, deleteMoodCheckin, fetchMoodCheckins } from '@/lib/mood-api';
import { MOOD_FACES, buildTrend, latestToday, moodLabel, type TrendDay } from './trend';

/** The mock's tag set; customizable per-widget via settings later. */
export const DEFAULT_MOOD_TAGS = ['focused', 'energetic', 'stressed', 'tired'] as const;

export const moodSettingsSchema = z.object({
  tags: z
    .array(z.string().min(1))
    .max(12)
    .default([...DEFAULT_MOOD_TAGS]),
});

export type MoodSettings = z.input<typeof moodSettingsSchema>;

const QUERY_KEY = ['mood'];

/* Chart geometry lifted from the design mock's trend SVG: 280×92 viewBox,
   gridlines at scores 5/3/1 (y 10/37/64), 7 points 44px apart. */
const CHART = { width: 280, height: 92, left: 8, right: 272, top: 10, bottom: 64 };

function chartX(index: number, count: number): number {
  if (count <= 1) return (CHART.left + CHART.right) / 2;
  return CHART.left + (index * (CHART.right - CHART.left)) / (count - 1);
}

function chartY(average: number): number {
  return CHART.bottom - ((average - 1) / 4) * (CHART.bottom - CHART.top);
}

function TrendChart({ trend }: { trend: TrendDay[] }): ReactElement {
  const points = trend
    .map((day, index) => ({ day, index }))
    .filter(
      (entry): entry is { day: TrendDay & { average: number }; index: number } =>
        entry.day.average !== null,
    )
    .map(({ day, index }) => ({
      x: chartX(index, trend.length),
      y: chartY(day.average),
    }));

  const line = points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const area =
    points.length > 1 && first && last
      ? `${line} L${last.x} ${CHART.bottom} L${first.x} ${CHART.bottom} Z`
      : null;

  const description = trend
    .map((day) => (day.average === null ? 'no entry' : day.average.toFixed(1)))
    .join(', ');

  return (
    <svg
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      role="img"
      aria-label={t('mood.chartLabel', { days: trend.length, description })}
    >
      {[CHART.top, (CHART.top + CHART.bottom) / 2, CHART.bottom].map((y) => (
        <line
          key={y}
          x1={CHART.left}
          y1={y}
          x2={CHART.right}
          y2={y}
          className="cc-mood-grid-line"
          strokeWidth="1"
        />
      ))}
      {area && <path d={area} className="cc-mood-trend-area" />}
      {points.length > 1 && (
        <path
          d={line}
          fill="none"
          className="cc-mood-trend-line"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {last && (
        <circle cx={last.x} cy={last.y} r="4" className="cc-mood-trend-dot" strokeWidth="2" />
      )}
      <g textAnchor="middle">
        {trend.map((day, index) => (
          <text
            key={day.key}
            className="cc-mood-axis-lbl"
            x={chartX(index, trend.length)}
            y={CHART.height - 8}
          >
            {day.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

/**
 * Mood check-in — the reflection widget (ADR Phase 1, mock's "Mood check-in"
 * card). Tapping a face logs a check-in immediately with whichever tags are
 * toggled on (frictionless, like braindump); Undo deletes it. The 7-day
 * trend averages each local day's check-ins.
 */
export function MoodWidget({ settings }: WidgetProps<MoodSettings>): ReactElement {
  const queryClient = useQueryClient();
  const availableTags = settings.tags ?? [...DEFAULT_MOOD_TAGS];
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [lastLogged, setLastLogged] = useState<MoodCheckin | null>(null);

  const moodQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchMoodCheckins(),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const logMutation = useMutation({
    mutationFn: createMoodCheckin,
    onSuccess: (checkin) => {
      setLastLogged(checkin);
      return invalidate();
    },
  });

  const undoMutation = useMutation({
    mutationFn: deleteMoodCheckin,
    onSuccess: () => {
      setLastLogged(null);
      return invalidate();
    },
  });

  const items = moodQuery.data?.items ?? [];
  const today = latestToday(items);
  const current = lastLogged ?? today;
  const trend = buildTrend(items);
  const latest = items.length > 0 ? items[0] : null;

  function toggleTag(tag: string): void {
    setSelectedTags((tags) =>
      tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
    );
  }

  function logMood(score: MoodScore): void {
    if (logMutation.isPending) return;
    logMutation.mutate({ score, tags: selectedTags, note: null });
  }

  return (
    <WidgetBody className="cc-mood">
      <p className="cc-mood-q">{t('mood.question')}</p>

      <div className="cc-mood-scale" role="group" aria-label={t('mood.scaleLabel')}>
        {MOOD_FACES.map((face) => (
          <button
            key={face.score}
            type="button"
            className="cc-mood-face"
            aria-pressed={current?.score === face.score}
            aria-label={face.label}
            disabled={logMutation.isPending}
            onClick={() => logMood(face.score)}
          >
            <span aria-hidden="true">{face.emoji}</span>
          </button>
        ))}
      </div>

      <div className="cc-chips" role="group" aria-label={t('mood.tagsLabel')}>
        {availableTags.map((tag) => {
          const on = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={on ? 'cc-chip cc-chip-toggle on' : 'cc-chip cc-chip-muted cc-chip-toggle'}
              aria-pressed={on}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {logMutation.isError || undoMutation.isError ? (
        <ErrorText>{t('mood.error.save')}</ErrorText>
      ) : lastLogged ? (
        <p className="cc-hint" role="status">
          {t('mood.logged', { label: moodLabel(lastLogged.score) })}{' '}
          <Button
            variant="link"
            size="sm"
            disabled={undoMutation.isPending}
            onClick={() => undoMutation.mutate(lastLogged.id)}
          >
            {t('mood.undo')}
          </Button>
        </p>
      ) : null}

      <div className="cc-mood-trend">
        <div className="cc-mood-trend-head">
          <span className="cc-mood-trend-lbl">{t('mood.trend')}</span>
          <span className="cc-mood-trend-val">
            {latest ? `${moodLabel(latest.score)} · ${latest.score}/5` : '—'}
          </span>
        </div>
        {moodQuery.isPending ? (
          <Skeleton shapes={['row']} label={t('mood.loading')} />
        ) : moodQuery.isError ? (
          <WidgetMessage
            tone="error"
            action={{
              label: t('common.retry'),
              icon: <RetryIcon />,
              onClick: () => void moodQuery.refetch(),
            }}
          >
            {t('mood.error.load')}
          </WidgetMessage>
        ) : items.length === 0 ? (
          <WidgetMessage>{t('mood.empty')}</WidgetMessage>
        ) : (
          <TrendChart trend={trend} />
        )}
      </div>
    </WidgetBody>
  );
}
