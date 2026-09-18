'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
} from 'react';
import type { LayoutResponse, WidgetLayoutItem } from '@command-center/contracts';
import {
  clampToDeclaredSize,
  describeSettingsSchema,
  WidgetCard,
  WidgetErrorBoundary,
  type SettingsValues,
  type WidgetProps,
} from '@command-center/ui';
import { fetchLayout, putLayout } from '@/lib/layout-api';
import { t } from '@/lib/i18n';
import { DEFAULT_LAYOUT } from '@/widgets/default-layout';
import { widgetRegistry } from '@/widgets/registry';
import { WidgetSettingsDialog } from './widget-settings-dialog';

const GRID_COLUMNS = 6;
const LAYOUT_QUERY_KEY = ['layout'];

/** Stable identity of a placement: definition + instance (ADR-013). */
function placementKey(item: WidgetLayoutItem): string {
  return `${item.widgetId}:${item.instanceKey}`;
}

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

interface DashboardWidgetProps {
  item: WidgetLayoutItem;
  onSaveSettings: (item: WidgetLayoutItem, settings: SettingsValues) => Promise<void>;
}

function DashboardWidget({ item, onSaveSettings }: DashboardWidgetProps): ReactElement {
  const definition = widgetRegistry.get(item.widgetId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Introspected once per definition; an empty field list means no gear.
  const fields = useMemo(
    () => (definition ? describeSettingsSchema(definition.settingsSchema) : []),
    [definition],
  );

  if (!definition) {
    return (
      <WidgetCard title={item.widgetId}>
        <p className="cc-widget-placeholder">{t('shell.unknownWidget', { id: item.widgetId })}</p>
      </WidgetCard>
    );
  }

  // Per-widget settings come from the API as unknown JSON; validate against
  // the widget's own schema and fall back to its defaults if invalid.
  const parsed = definition.settingsSchema.safeParse(item.settings);
  const settings: unknown = parsed.success ? parsed.data : definition.defaultSettings;

  // Declared sizes are the contract (ADR §4.2): snap an undeclared footprint.
  const size = clampToDeclaredSize({ w: item.gridPos.w, h: item.gridPos.h }, definition.sizes);

  // The registry erases TSettings (stores WidgetDefinition<never>); widen the
  // component back to accept the validated settings value.
  const Widget = definition.component as ComponentType<WidgetProps<unknown>>;

  const handleSave = async (next: SettingsValues): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveSettings(item, next);
      setSettingsOpen(false);
    } catch {
      setSaveError(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WidgetErrorBoundary widgetTitle={definition.title}>
      <WidgetCard
        title={definition.title}
        icon={definition.icon}
        accent={definition.accent}
        quickActions={definition.quickActions}
        onOpenSettings={fields.length > 0 ? (): void => setSettingsOpen(true) : undefined}
        settingsLabel={t('settings.open', { title: definition.title })}
      >
        <Widget settings={settings} size={size} />
      </WidgetCard>
      {settingsOpen && (
        <WidgetSettingsDialog
          definition={definition}
          fields={fields}
          current={settings as SettingsValues}
          saving={saving}
          error={saveError}
          onSave={(next) => void handleSave(next)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </WidgetErrorBoundary>
  );
}

export function DashboardGrid(): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: LAYOUT_QUERY_KEY,
    queryFn: fetchLayout,
  });

  // The settings panel is the first PUT /layout caller: it writes the whole
  // list back with one item's settings replaced, and the query cache takes
  // the server's echo so every card re-reads its validated settings.
  const saveSettings = useMutation({
    mutationFn: (next: WidgetLayoutItem[]) => putLayout(next),
    onSuccess: (response: LayoutResponse) => {
      queryClient.setQueryData(LAYOUT_QUERY_KEY, response);
    },
  });

  if (isPending) {
    return (
      <p className="cc-status" role="status">
        {t('shell.loadingDashboard')}
      </p>
    );
  }

  // API unreachable, invalid response, or empty layout → default layout.
  const items: WidgetLayoutItem[] =
    isError || !data || data.items.length === 0 ? DEFAULT_LAYOUT : data.items;

  const handleSaveSettings = async (
    target: WidgetLayoutItem,
    settings: SettingsValues,
  ): Promise<void> => {
    const next = items.map((item) =>
      placementKey(item) === placementKey(target) ? { ...item, settings } : item,
    );
    await saveSettings.mutateAsync(next);
  };

  return (
    <div className="cc-grid">
      {items.map((item) => (
        <div key={placementKey(item)} className="cc-grid-item" style={gridPlacement(item)}>
          <DashboardWidget item={item} onSaveSettings={handleSaveSettings} />
        </div>
      ))}
    </div>
  );
}
