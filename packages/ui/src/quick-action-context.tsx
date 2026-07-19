'use client';

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * Quick-action bus (ADR §4.2): the widget chrome (WidgetCard) renders the
 * quickActions declared in a widget's manifest, but the *handler* for an
 * action lives inside the widget component (e.g. reminders' "add-automation"
 * opens its builder modal). The bus decouples the two: the card dispatches,
 * the widget subscribes.
 */
export interface QuickActionBus {
  /** Register a handler for an action id; returns an unsubscribe function. */
  subscribe(actionId: string, handler: () => void): () => void;
  /** Fire every handler registered for an action id. */
  dispatch(actionId: string): void;
}

export function createQuickActionBus(): QuickActionBus {
  const handlers = new Map<string, Set<() => void>>();

  return {
    subscribe(actionId, handler): () => void {
      let set = handlers.get(actionId);
      if (!set) {
        set = new Set();
        handlers.set(actionId, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    dispatch(actionId): void {
      const set = handlers.get(actionId);
      if (!set) return;
      // Copy before iterating: a handler may unsubscribe itself.
      for (const handler of [...set]) {
        handler();
      }
    },
  };
}

const QuickActionContext = createContext<QuickActionBus | null>(null);

/** Provided by WidgetCard around the widget body. Exported for tests. */
export const QuickActionProvider = QuickActionContext.Provider;

/**
 * Widget-side: run `handler` when the card chrome (or the widget itself, via
 * useQuickActionDispatch) fires the quick action `actionId`. Safe to call
 * outside a WidgetCard (no-op) so widgets stay renderable standalone.
 */
export function useQuickAction(actionId: string, handler: () => void): void {
  const bus = useContext(QuickActionContext);

  // Latest-ref pattern: resubscribing on every handler identity change would
  // churn the bus; instead the subscription is stable and reads the ref.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!bus) return;
    return bus.subscribe(actionId, () => {
      handlerRef.current();
    });
  }, [bus, actionId]);
}

/**
 * Widget-side: programmatically fire one of the widget's own quick actions
 * (e.g. an empty state's "Add reminder" button reusing the header "+"
 * action's handler). No-op outside a WidgetCard.
 */
export function useQuickActionDispatch(): (actionId: string) => void {
  const bus = useContext(QuickActionContext);
  return useCallback(
    (actionId: string) => {
      bus?.dispatch(actionId);
    },
    [bus],
  );
}
