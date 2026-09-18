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
  /**
   * When set, the header shows a settings (gear) button that calls this —
   * the shell opens the auto-generated settings panel (ADR §4.2). Omitted
   * for widgets whose schema has no fields.
   */
  onOpenSettings?: () => void;
  /** Accessible name of the settings button, e.g. "Settings for Clock". */
  settingsLabel?: string;
  children: ReactNode;
}

const gearIcon = (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
);

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
  onOpenSettings,
  settingsLabel,
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
        {((quickActions && quickActions.length > 0) || onOpenSettings) && (
          <div className="cc-widget-card-actions">
            {quickActions?.map((action) => (
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
            {onOpenSettings && (
              <button
                type="button"
                className="cc-widget-card-action cc-widget-card-settings"
                aria-label={settingsLabel ?? `Settings for ${title}`}
                aria-haspopup="dialog"
                onClick={onOpenSettings}
              >
                <span aria-hidden="true">{gearIcon}</span>
              </button>
            )}
          </div>
        )}
      </header>
      <div className="cc-widget-card-body">
        <QuickActionProvider value={bus}>{children}</QuickActionProvider>
      </div>
    </section>
  );
}
