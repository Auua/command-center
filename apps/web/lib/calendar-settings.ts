'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchLayout } from '@/lib/layout-api';
import { fetchProfile } from '@/lib/profile-api';
import { browserZone } from './calendar-dates';

/**
 * The calendar widget's settings (ADR-018), shared with the `/calendar`
 * page: it lands on `defaultView` and lays weeks out from `weekStartsOn`.
 * Week start is a named day, not ADR-018's 0..6, so the generated settings
 * form shows words. Day and week views arrive in step 4D-2.
 */
export const calendarSettingsSchema = z.object({
  defaultView: z.enum(['agenda', 'month']).default('agenda'),
  weekStartsOn: z.enum(['monday', 'sunday', 'saturday']).default('monday'),
  showTaskDeadlines: z.boolean().default(true),
});
export type CalendarSettings = z.input<typeof calendarSettingsSchema>;
export type ResolvedCalendarSettings = z.output<typeof calendarSettingsSchema>;

export const WEEK_START: Record<ResolvedCalendarSettings['weekStartsOn'], number> = {
  sunday: 0,
  monday: 1,
  saturday: 6,
};

export function resolveCalendarSettings(settings: unknown): ResolvedCalendarSettings {
  const parsed = calendarSettingsSchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : calendarSettingsSchema.parse({});
}

/**
 * The calendar card's settings as placed on the dashboard (defaults when it
 * isn't). `loaded` turns true once the layout has answered — or failed —
 * so a setting that saves a request (the task overlay) is known first.
 */
export function useCalendarSettings(): ResolvedCalendarSettings & { loaded: boolean } {
  const layout = useQuery({ queryKey: ['layout'], queryFn: fetchLayout, staleTime: 60_000 });
  const item = layout.data?.items.find((placed) => placed.widgetId === 'calendar');
  return { ...resolveCalendarSettings(item?.settings), loaded: !layout.isPending };
}

/**
 * The home timezone timed events are shown in (ADR-018, the profile's
 * zone). Until the profile answers — or when there is none yet — the
 * browser's zone stands in; every range response names the zone too.
 */
export function useHomeZone(): string {
  const profile = useQuery({ queryKey: ['profile'], queryFn: fetchProfile, staleTime: 300_000 });
  return profile.data?.timezone ?? browserZone();
}
