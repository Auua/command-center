import type { ReactElement } from 'react';

/** Brush-stroke square glyph for the widget chip (15px stroke icon like the others). */
export function kanjiIcon(): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 9h8" />
      <path d="M12 9v8" />
      <path d="M8 14h8" />
    </svg>
  );
}
