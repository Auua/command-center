'use client';

import { useEffect, useState } from 'react';

/**
 * Is the same journal entry open in another tab? (ADR-016 multi-tab rule:
 * warn instead of racing silently; the PATCH version check is the
 * backstop.) Tabs announce themselves on a BroadcastChannel and answer each
 * other; a closing tab says goodbye. Without BroadcastChannel: false.
 */
const CHANNEL = 'cc-journal-tabs';

type Message = { type: 'open' | 'here' | 'closed'; key: string; tab: string };

export function useOtherTabEditing(key: string): boolean {
  const [others, setOthers] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const tab = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel(CHANNEL);
    const post = (type: Message['type']): void => channel.postMessage({ type, key, tab });
    channel.onmessage = (event: MessageEvent<Message>): void => {
      const message = event.data;
      if (!message || message.key !== key || message.tab === tab) return;
      setOthers((current) => {
        const next = new Set(current);
        if (message.type === 'closed') next.delete(message.tab);
        else next.add(message.tab);
        return next;
      });
      if (message.type === 'open') post('here');
    };
    post('open');
    const leave = (): void => post('closed');
    window.addEventListener('pagehide', leave);
    return (): void => {
      window.removeEventListener('pagehide', leave);
      leave();
      channel.close();
      setOthers(new Set());
    };
  }, [key]);

  return others.size > 0;
}
