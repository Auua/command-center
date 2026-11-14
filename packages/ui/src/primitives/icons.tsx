import type { ReactElement } from 'react';

/**
 * Shared stroke glyphs for widget actions (ADR §4.2 design system). All
 * are decorative: callers pair them with visible text or an aria-label.
 */

interface IconProps {
  /** Rendered square size in px (default 14). */
  size?: number;
  /** Stroke width (default 2.2). */
  stroke?: number;
}

function Svg({
  size = 14,
  stroke = 2.2,
  children,
}: IconProps & { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function SkipIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M5 4l10 8-10 8z" />
      <path d="M19 5v14" />
    </Svg>
  );
}

export function NextIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
    </Svg>
  );
}

export function RetryIcon(props: IconProps = {}): ReactElement {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}
