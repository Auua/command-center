import type { ReactElement } from 'react';
import { JournalTimeline } from '@/components/journal/journal-timeline';

/** /journal — the timeline (ADR-016). */
export default function JournalPage(): ReactElement {
  return <JournalTimeline />;
}
