import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Calendar · Command Center' };

/**
 * The calendar's expanded view (ADR-018) lives outside the dashboard shell,
 * like the journal: a full-width working surface with a way back.
 */
export default async function CalendarLayout({
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
            <Link href="/calendar">Calendar</Link>
          </h1>
        </div>
      </header>
      <main className="cc-main cc-calendar-main">{children}</main>
    </div>
  );
}
