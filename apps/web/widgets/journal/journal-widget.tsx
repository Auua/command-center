'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, type ReactElement } from 'react';
import { z } from 'zod';
import { JournalPromptCategorySchema, type JournalPromptCategory } from '@command-center/contracts';
import {
  RetryIcon,
  Skeleton,
  useQuickAction,
  WidgetBody,
  WidgetMessage,
  type WidgetProps,
} from '@command-center/ui';
import { t } from '@/lib/i18n';
import { fetchJournalToday } from '@/lib/journal-api';
import { rememberReturnFocus, takeReturnFocus } from '@/lib/return-focus';

export const journalSettingsSchema = z.object({
  showPrompt: z.boolean().default(true),
  promptCategories: z.array(JournalPromptCategorySchema).default([]),
});
export type JournalSettings = z.input<typeof journalSettingsSchema>;

/** The element the editor's "Back" returns focus to (ADR-016). */
export const JOURNAL_CTA_ID = 'journal-widget-cta';

/**
 * Journal launcher (ADR-016): today's prompt and one call to action. The
 * editor lives on its own route, so no editor code loads on the dashboard.
 * Written today → "Edit today's entry" with the preview; otherwise the
 * prompt + "Write today's entry", the prompt describing the button.
 */
export function JournalWidget({ settings }: WidgetProps<JournalSettings>): ReactElement {
  const router = useRouter();
  const promptId = useId();
  const cta = useRef<HTMLAnchorElement>(null);
  const showPrompt = settings.showPrompt ?? true;
  const categories: JournalPromptCategory[] = settings.promptCategories ?? [];

  const today = useQuery({
    queryKey: ['journal', 'today', categories],
    queryFn: () => fetchJournalToday(categories),
  });

  const entry = today.data?.entry ?? null;
  const prompt = showPrompt ? (today.data?.prompt ?? null) : null;
  const newHref = `/journal/new?from=dashboard${prompt ? `&promptId=${prompt.id}` : ''}`;
  const href = entry ? `/journal/${entry.id}?from=dashboard` : newHref;

  useQuickAction('write-journal', () => {
    rememberReturnFocus(JOURNAL_CTA_ID);
    router.push(newHref);
  });

  useEffect(() => {
    if (today.isSuccess && takeReturnFocus(JOURNAL_CTA_ID)) cta.current?.focus();
  }, [today.isSuccess]);

  if (today.isPending) {
    return <Skeleton shapes={['line', 'short']} label={t('journal.widget.loading')} />;
  }
  if (today.isError) {
    return (
      <WidgetMessage
        tone="error"
        hint={<Link href="/journal/new?from=dashboard">{t('journal.widget.writeAnyway')}</Link>}
        action={{
          label: t('common.retry'),
          icon: <RetryIcon />,
          onClick: () => void today.refetch(),
        }}
      >
        {t('journal.widget.error')}
      </WidgetMessage>
    );
  }

  return (
    <WidgetBody>
      <div className="cc-journal-card">
        {entry ? (
          <>
            <p className="cc-journal-card-preview">
              {entry.textPreview || t('journal.timeline.blank')}
            </p>
            <p className="cc-hint">
              {t('journal.widget.writtenToday', { count: entry.wordCount })}
            </p>
          </>
        ) : (
          prompt && (
            <p id={promptId} className="cc-journal-card-prompt">
              {prompt.text}
            </p>
          )
        )}
        <div className="cc-journal-card-actions">
          <Link
            ref={cta}
            id={JOURNAL_CTA_ID}
            href={href}
            className="cc-btn"
            aria-describedby={!entry && prompt ? promptId : undefined}
            onClick={() => rememberReturnFocus(JOURNAL_CTA_ID)}
          >
            {entry ? t('journal.widget.edit') : t('journal.widget.write')}
          </Link>
          <Link href="/journal" className="cc-btn cc-btn-ghost cc-btn-sm">
            {t('journal.widget.open')}
          </Link>
        </div>
      </div>
    </WidgetBody>
  );
}
