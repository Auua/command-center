import type { ReactElement } from 'react';
import { JournalEditorLoader } from '@/components/journal/journal-editor-loader';

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isPromptId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);

/** /journal/new?date=YYYY-MM-DD&promptId=…&from=dashboard (ADR-016). */
export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params = await searchParams;
  return (
    <JournalEditorLoader
      {...(isDate(params.date) ? { date: params.date } : {})}
      {...(isPromptId(params.promptId) ? { promptId: params.promptId } : {})}
      {...(params.from === 'dashboard' ? { from: 'dashboard' as const } : {})}
    />
  );
}
