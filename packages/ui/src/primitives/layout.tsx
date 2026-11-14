import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { CheckIcon } from './icons';

/** Vertical stack that fills the card so a footer can sit at the bottom. */
export function WidgetBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement>): ReactElement {
  return (
    <article className={className ? `cc-body ${className}` : 'cc-body'} {...rest}>
      {children}
    </article>
  );
}

/** Bottom row: actions on the left, links and status on the right. */
export function WidgetFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div className={className ? `cc-footer ${className}` : 'cc-footer'} {...rest}>
      {children}
    </div>
  );
}

/** "Learned ✓ — next tomorrow": the resolved state that replaces the primary action. */
export function DoneState({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="cc-done">
      <span aria-hidden="true">
        <CheckIcon />
      </span>{' '}
      {children}
    </p>
  );
}

/** Right-aligned small external link (e.g. "Open note"). */
export function SourceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): ReactElement {
  return (
    <a className="cc-source" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** Hairline-separated list; rows are `<ListItem>`. */
export function List({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLUListElement>): ReactElement {
  return (
    <ul className={className ? `cc-list ${className}` : 'cc-list'} {...rest}>
      {children}
    </ul>
  );
}

export function ListItem({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLLIElement>): ReactElement {
  return (
    <li className={className ? `cc-list-item ${className}` : 'cc-list-item'} {...rest}>
      {children}
    </li>
  );
}

/** Uppercase kicker that separates two groups inside a card. */
export function SectionLabel({ children }: { children: ReactNode }): ReactElement {
  return <h3 className="cc-section-label">{children}</h3>;
}
