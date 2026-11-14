import type { ReactElement, ReactNode } from 'react';
import { Button } from './button';

export type GhostShape = 'title' | 'line' | 'short' | 'row';

export interface SkeletonProps {
  /** Ghost blocks top to bottom (default: title, line, short). */
  shapes?: readonly GhostShape[];
  /** Visually-hidden text announced to assistive tech while loading. */
  label?: string;
}

/**
 * Loading placeholder that mirrors the card's layout so content does not
 * jump in. Decorative to assistive tech; pass `label` for a polite
 * "Loading…" announcement.
 */
export function Skeleton({
  shapes = ['title', 'line', 'short'],
  label,
}: SkeletonProps): ReactElement {
  return (
    <>
      {label && (
        <p className="cc-visually-hidden" role="status">
          {label}
        </p>
      )}
      <div className="cc-skeleton" aria-hidden="true">
        {shapes.map((shape, index) => (
          <span key={index} className={`cc-ghost cc-ghost-${shape}`} />
        ))}
      </div>
    </>
  );
}

export type MessageTone = 'empty' | 'error' | 'info';

export interface WidgetMessageProps {
  tone?: MessageTone;
  /** The headline — for `error` it is rendered with role="alert". */
  children: ReactNode;
  /** Muted second line (a runbook pointer, a next step). */
  hint?: ReactNode;
  /** Optional single action (retry, raise ceiling…). */
  action?: { label: string; onClick: () => void; icon?: ReactNode };
}

/**
 * One block for every non-content state a widget can be in: nothing to show
 * yet, could not load, or an informational notice. Errors are announced;
 * the other tones are read in flow. The action is always a ghost button so
 * the card's primary accent stays reserved for its real actions.
 */
export function WidgetMessage({
  tone = 'empty',
  children,
  hint,
  action,
}: WidgetMessageProps): ReactElement {
  return (
    <div className={`cc-message cc-message-${tone}`}>
      <p className="cc-message-text" role={tone === 'error' ? 'alert' : undefined}>
        {children}
      </p>
      {hint && <p className="cc-hint">{hint}</p>}
      {action && (
        <Button variant="ghost" size="sm" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Muted small print inside a card. */
export function Hint({ children, lang }: { children: ReactNode; lang?: string }): ReactElement {
  return (
    <p className="cc-hint" lang={lang}>
      {children}
    </p>
  );
}

/** Inline failure line under a form or a row — announced as an alert. */
export function ErrorText({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="cc-error" role="alert">
      {children}
    </p>
  );
}
