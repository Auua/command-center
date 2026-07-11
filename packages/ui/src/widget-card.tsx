import type { ReactNode } from "react";

interface WidgetCardProps {
  title: string;
  children: ReactNode;
}

/** Shared widget chrome: title bar + content area. */
export function WidgetCard({ title, children }: WidgetCardProps) {
  return (
    <section className="cc-widget-card" aria-label={title}>
      <header className="cc-widget-card-header">
        <h2>{title}</h2>
      </header>
      <div className="cc-widget-card-body">{children}</div>
    </section>
  );
}
