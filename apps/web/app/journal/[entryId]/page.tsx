import type { ReactElement } from 'react';
import { JournalEditorLoader } from '@/components/journal/journal-editor-loader';

/** /journal/[entryId] — open a saved entry in the editor (ADR-016). */
export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const [{ entryId }, query] = await Promise.all([params, searchParams]);
  return (
    <JournalEditorLoader
      entryId={entryId}
      {...(query.from === 'dashboard' ? { from: 'dashboard' as const } : {})}
    />
  );
}
