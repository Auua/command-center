'use client';

import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { createQuickActionBus, QuickActionProvider } from './quick-action-context';
import type { QuickAction } from './widget';

interface WidgetCardProps {
  title: string;
  /** Chip icon shown left of the title (design mock's .chip-icon). */
  icon?: ReactNode;
  /** Accent color (design mock's --wc); tints the chip icon. */
  accent?: string;
  /**
   * Header action buttons from the widget's manifest (ADR §4.2). Clicking one
   * dispatches its id on the card's quick-action bus; the widget subscribes
   * via useQuickAction(id, handler).
   */
  quickActions?: QuickAction[];
  children: ReactNode;
}

/**
 * Shared widget chrome, per the design mock's .card: accent-tinted icon
 * chip + uppercase kicker title + quick-action buttons, then the content
 * area (wrapped in a QuickActionProvider so the widget can receive and
 * fire quick actions).
 */
export function WidgetCard({
  title,
  icon,
  accent,
  quickActions,
  children,
}: WidgetCardProps): ReactElement {
  const [bus] = useState(createQuickActionBus);
  const style = accent ? ({ '--cc-wc': accent } as CSSProperties) : undefined;

  return (
    <section className="cc-widget-card" aria-label={title} style={style}>
      <header className="cc-widget-card-header">
        {icon && (
          <span className="cc-widget-chip" aria-hidden="true">
            {icon}
          </span>
        )}
        <h2>{title}</h2>
        {quickActions && quickActions.length > 0 && (
          <div className="cc-widget-card-actions">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="cc-widget-card-action"
                aria-label={action.label}
                onClick={() => bus.dispatch(action.id)}
              >
                {action.icon ? <span aria-hidden="true">{action.icon}</span> : action.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="cc-widget-card-body">
        <QuickActionProvider value={bus}>{children}</QuickActionProvider>
      </div>
    </section>
  );
}
