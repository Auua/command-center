'use client';

import { useQuery } from '@tanstack/react-query';
import type { ComponentType, CSSProperties, ReactElement } from 'react';
import type { WidgetLayoutItem } from '@command-center/contracts';
import { WidgetCard, WidgetErrorBoundary, type WidgetProps } from '@command-center/ui';
import { fetchLayout } from '@/lib/layout-api';
import { DEFAULT_LAYOUT } from '@/widgets/default-layout';
import { widgetRegistry } from '@/widgets/registry';

const GRID_COLUMNS = 6;

/**
 * Grid placement via CSS custom properties (consumed in globals.css) so a
 * mobile media query can collapse to a single column without fighting
 * inline styles. Spans are clamped to the 6-column track list.
 */
function gridPlacement(item: WidgetLayoutItem): CSSProperties {
  const x = Math.min(Math.max(item.gridPos.x, 0), GRID_COLUMNS - 1);
  const w = Math.min(Math.max(item.gridPos.w, 1), GRID_COLUMNS - x);
  const y = Math.max(item.gridPos.y, 0);
  const h = Math.max(item.gridPos.h, 1);

  return {
    '--cc-col': `${x + 1} / span ${w}`,
    '--cc-row': `${y + 1} / span ${h}`,
  } as CSSProperties;
}

function DashboardWidget({ item }: { item: WidgetLayoutItem }): ReactElement {
  const definition = widgetRegistry.get(item.widgetId);

  if (!definition) {
    return (
      <WidgetCard title={item.widgetId}>
        <p className="cc-widget-placeholder">
          Unknown widget &ldquo;{item.widgetId}&rdquo;. It may have been removed or not registered
          yet.
        </p>
      </WidgetCard>
    );
  }

  // Per-widget settings come from the API as unknown JSON; validate against
  // the widget's own schema and fall back to its defaults if invalid.
  const parsed = definition.settingsSchema.safeParse(item.settings);
  const settings: unknown = parsed.success ? parsed.data : definition.defaultSettings;

  // The registry erases TSettings (stores WidgetDefinition<never>); widen the
  // component back to accept the validated settings value.
  const Widget = definition.component as ComponentType<WidgetProps<unknown>>;

  return (
    <WidgetErrorBoundary widgetTitle={definition.title}>
      <WidgetCard title={definition.title} icon={definition.icon} accent={definition.accent}>
        <Widget settings={settings} size={{ w: item.gridPos.w, h: item.gridPos.h }} />
      </WidgetCard>
    </WidgetErrorBoundary>
  );
}

export function DashboardGrid(): ReactElement {
  const { data, isPending, isError } = useQuery({
    queryKey: ['layout'],
    queryFn: fetchLayout,
  });

  if (isPending) {
    return (
      <p className="cc-status" role="status">
        Loading dashboard…
      </p>
    );
  }

  // API unreachable, invalid response, or empty layout → default layout.
  const items: WidgetLayoutItem[] =
    isError || !data || data.items.length === 0 ? DEFAULT_LAYOUT : data.items;

  return (
    <div className="cc-grid">
      {items.map((item, index) => (
        <div key={`${item.widgetId}:${index}`} className="cc-grid-item" style={gridPlacement(item)}>
          <DashboardWidget item={item} />
        </div>
      ))}
    </div>
  );
}
