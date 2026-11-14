import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

export type ChipTone =
  'accent' | 'muted' | 'coral' | 'sky' | 'green' | 'amber' | 'violet' | 'danger';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** `accent` tints with the hosting widget's accent (`--cc-wc`). */
  tone?: ChipTone;
  children: ReactNode;
}

/** Small rounded label — JLPT level, priority, kind, status. Never the only carrier of meaning. */
export function Chip({ tone = 'accent', className, children, ...rest }: ChipProps): ReactElement {
  const classes = ['cc-chip'];
  if (tone !== 'accent') classes.push(`cc-chip-${tone}`);
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} {...rest}>
      {children}
    </span>
  );
}

/** A wrapping row of chips, typically the first line of a card. */
export function ChipRow({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>): ReactElement {
  return (
    <p className={className ? `cc-chips ${className}` : 'cc-chips'} {...rest}>
      {children}
    </p>
  );
}
