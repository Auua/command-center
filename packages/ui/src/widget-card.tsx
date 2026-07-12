import type { CSSProperties, ReactElement, ReactNode } from 'react';

interface WidgetCardProps {
  title: string;
  /** Chip icon shown left of the title (design mock's .chip-icon). */
  icon?: ReactNode;
  /** Accent color (design mock's --wc); tints the chip icon. */
  accent?: string;
  children: ReactNode;
}

/**
 * Shared widget chrome, per the design mock's .card: accent-tinted icon
 * chip + uppercase kicker title, then the content area.
 */
export function WidgetCard({ title, icon, accent, children }: WidgetCardProps): ReactElement {
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
      </header>
      <div className="cc-widget-card-body">{children}</div>
    </section>
  );
}
