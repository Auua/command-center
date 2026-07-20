import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { createClient } from '@/lib/supabase/server';
import { DashboardBootstrap } from '@/components/dashboard-bootstrap';
import { DashboardGrid } from '@/components/dashboard-grid';
import { NotificationBell } from '@/components/notification-bell';
import { signOut } from './auth/actions';

/** Dashboard shell (ADR §4.2). Server Component; widgets hydrate client-side. */
export default async function DashboardPage(): Promise<ReactElement> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is defense in depth.
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="cc-shell">
      <header className="cc-header">
        <h1>Command Center</h1>
        <div className="cc-header-actions">
          <NotificationBell />
          <span className="cc-user-email">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="cc-btn cc-btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="cc-main">
        <DashboardGrid />
      </main>
      <DashboardBootstrap />
    </div>
  );
}
