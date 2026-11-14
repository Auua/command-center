import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { CloseIcon } from './icons';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'link';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  /** Decorative glyph placed before the label. */
  icon?: ReactNode;
  /** Sets aria-busy and disables the control while an action is in flight. */
  busy?: boolean;
  /** Compact padding for footers and inline rows. */
  size?: 'md' | 'sm';
  /** Native type (default "button" — never an accidental form submit). */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * The one widget button: pill-shaped, accent-filled by default, ghost for
 * secondary actions, danger for destructive ones, link for inline undo-style
 * actions. `busy` is the house pattern for in-flight mutations — the button
 * stays in the tree (focus is kept) and announces aria-busy.
 */
export function Button({
  variant = 'primary',
  icon,
  busy = false,
  size = 'md',
  type = 'button',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps): ReactElement {
  const classes = ['cc-btn'];
  if (variant !== 'primary') classes.push(`cc-btn-${variant}`);
  if (size === 'sm') classes.push('cc-btn-sm');
  if (className) classes.push(className);
  return (
    <button
      type={type}
      className={classes.join(' ')}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}

export interface DismissButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'children'
> {
  /** Required accessible name, e.g. "Delete task: pay rent". */
  label: string;
}

/** The quiet "×" at the end of a list row (delete / dismiss). */
export function DismissButton({ label, className, ...rest }: DismissButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={className ? `cc-dismiss ${className}` : 'cc-dismiss'}
      aria-label={label}
      {...rest}
    >
      <CloseIcon size={13} />
    </button>
  );
}
