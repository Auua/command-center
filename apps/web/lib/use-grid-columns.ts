'use client';

import { useCallback, useEffect, useState } from 'react';
import { columnsForWidth, GRID_COLUMNS } from '@command-center/ui';

/**
 * Column count for the dashboard grid, from the grid's own width (ADR-042:
 * columns follow the width). Returns the count and a callback ref for the
 * grid element. Without ResizeObserver (jsdom, very old browsers) it stays
 * at the reference GRID_COLUMNS.
 */
export function useGridColumns(): [number, (node: HTMLElement | null) => void] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState(GRID_COLUMNS);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = (width: number): void => {
      const gap = Number.parseFloat(getComputedStyle(node).columnGap);
      setColumns(columnsForWidth(width, gap));
    };
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return (): void => observer.disconnect();
  }, [node]);

  const ref = useCallback((next: HTMLElement | null) => setNode(next), []);
  return [columns, ref];
}
