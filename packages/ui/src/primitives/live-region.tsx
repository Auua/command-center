'use client';

import { useCallback, useState, type ReactElement } from 'react';

export type AnnounceKind = 'polite' | 'alert';

export interface Announcer {
  /** Successes polite, failures alert — the house pattern. */
  announce: (kind: AnnounceKind, message: string) => void;
  /** Render once, anywhere inside the widget root. */
  regions: ReactElement;
}

/**
 * Persistent live regions for a widget: a polite status line that is
 * replaced on every success, and an alert line for failures. A polite
 * announcement clears a previous alert so stale errors do not linger.
 */
export function useAnnouncer(): Announcer {
  const [state, setState] = useState({ polite: '', alert: '' });
  const announce = useCallback((kind: AnnounceKind, message: string): void => {
    setState((current) =>
      kind === 'polite' ? { polite: message, alert: '' } : { ...current, alert: message },
    );
  }, []);
  const regions = (
    <>
      <p className="cc-visually-hidden" role="status" aria-live="polite">
        {state.polite}
      </p>
      <p className="cc-visually-hidden" role="alert">
        {state.alert}
      </p>
    </>
  );
  return { announce, regions };
}
