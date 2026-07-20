'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { fetchNotifications, markNotificationsRead } from '@/lib/notifications-api';
import { t } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relative-time';

const NOTIFICATIONS_KEY = ['notifications'];
const POPOVER_ID = 'cc-bell-popover';

function BellIcon(): ReactElement {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/**
 * The in-app notification center (ADR-039: the delivery of record) — a
 * native-popover panel off the header bell. Polling per plan §2: 60s
 * refetch + refetch-on-focus + service-worker 'cc:push' invalidation when
 * a push lands with a tab open; Supabase realtime stays the documented
 * upgrade path. Opening the panel marks everything read (D5).
 */
export function NotificationBell(): ReactElement {
  const queryClient = useQueryClient();
  const popoverRef = useRef<HTMLDivElement>(null);

  const listQuery = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => fetchNotifications(20),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const markReadMutation = useMutation({
    mutationFn: () => markNotificationsRead({ all: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const openPanel = useCallback((): void => {
    const popover = popoverRef.current;
    if (popover && 'showPopover' in popover) {
      try {
        popover.showPopover();
      } catch {
        // Already open — fine.
      }
    }
  }, []);

  // Service-worker messages: a push landing invalidates the list; a
  // notification click deep-links into the panel. The /?notification=<id>
  // cold-start deep link opens the panel too, then cleans the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('notification')) {
      openPanel();
      params.delete('notification');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `/?${query}` : '/');
    }

    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent): void => {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const type = (data as { type?: unknown }).type;
      if (type === 'cc:push') {
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      } else if (type === 'cc:notification-click') {
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        openPanel();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return (): void => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [openPanel, queryClient]);

  const unreadCount = listQuery.data?.unreadCount ?? 0;
  const label = unreadCount > 0 ? t('bell.label', { count: unreadCount }) : t('bell.labelNone');

  const handleToggle = (event: { newState?: string; nativeEvent?: Event }): void => {
    const newState =
      event.newState ?? (event.nativeEvent as { newState?: string } | undefined)?.newState;
    // D5: opening the panel marks everything read.
    if (newState === 'open' && unreadCount > 0 && !markReadMutation.isPending) {
      markReadMutation.mutate();
    }
  };

  return (
    <div className="cc-bell">
      <button
        type="button"
        className="cc-bell-button"
        aria-label={label}
        popoverTarget={POPOVER_ID}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="cc-bell-badge" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      <div
        ref={popoverRef}
        id={POPOVER_ID}
        popover="auto"
        className="cc-bell-panel"
        aria-label={t('bell.heading')}
        onToggle={handleToggle}
      >
        <h2 className="cc-bell-heading">{t('bell.heading')}</h2>
        {listQuery.isPending ? (
          <p role="status" className="cc-widget-placeholder">
            {t('bell.loading')}
          </p>
        ) : listQuery.isError ? (
          <p role="alert" className="cc-rem-error">
            {t('bell.failed')}
          </p>
        ) : listQuery.data.items.length === 0 ? (
          <p className="cc-widget-placeholder">{t('bell.empty')}</p>
        ) : (
          <ul className="cc-bell-list">
            {listQuery.data.items.map((notification) => {
              const unread = notification.readAt === null;
              return (
                <li
                  key={notification.id}
                  className={unread ? 'cc-bell-item cc-bell-item-unread' : 'cc-bell-item'}
                >
                  <p className="cc-bell-item-title">
                    {/* Unread is never color-only: dot glyph + hidden text. */}
                    {unread && (
                      <>
                        <span className="cc-bell-dot" aria-hidden="true" />
                        <span className="cc-visually-hidden">{t('bell.unread')} </span>
                      </>
                    )}
                    {notification.title}
                  </p>
                  {notification.body && <p className="cc-bell-item-body">{notification.body}</p>}
                  <time className="cc-bell-item-time" dateTime={notification.createdAt}>
                    {formatRelativeTime(notification.createdAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
