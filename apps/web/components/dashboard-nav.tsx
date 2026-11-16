import Link from 'next/link';
import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';
import { journalIcon } from '@/widgets/journal/icon';

/**
 * The dashboard header's links to the app's own pages. They are always
 * here, whatever the layout holds — the Journal card is optional, the
 * journal is not.
 */
export function DashboardNav(): ReactElement {
  return (
    <nav className="cc-header-nav" aria-label={t('nav.label')}>
      <Link href="/journal" className="cc-header-link">
        <span aria-hidden="true">{journalIcon}</span>
        {t('nav.journal')}
      </Link>
    </nav>
  );
}
