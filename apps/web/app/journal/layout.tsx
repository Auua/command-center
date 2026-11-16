import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Journal · Command Center' };

/**
 * Journal pages (ADR-016) live outside the dashboard shell: a full-width
 * writing surface with a way back. No third-party analytics or trackers on
 * any /journal route (ADR §5.3) — this layout adds none, and none exist
 * app-wide; keep it that way.
 */
export default async function JournalLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already guards this route; this is defense in depth.
  if (!user) redirect('/login');

  return (
    <div className="cc-shell">
      <header className="cc-header">
        <div className="cc-header-actions">
          <Link href="/" className="cc-header-home">
            Command Center
          </Link>
          <span aria-hidden="true">/</span>
          <h1>
            <Link href="/journal">Journal</Link>
          </h1>
        </div>
      </header>
      <main className="cc-main cc-journal-main">{children}</main>
    </div>
  );
}
