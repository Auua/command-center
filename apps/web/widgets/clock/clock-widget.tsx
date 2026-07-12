'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { z } from 'zod';
import type { WidgetProps } from '@command-center/ui';

export const clockSettingsSchema = z.object({
  hour12: z.boolean().default(false),
});

/**
 * Input type of the schema ({ hour12?: boolean }) so the schema satisfies
 * z.ZodType<ClockSettings> despite the .default() (input vs output types).
 */
export type ClockSettings = z.input<typeof clockSettingsSchema>;

export function ClockWidget({ settings }: WidgetProps<ClockSettings>): ReactElement {
  // null until mounted: avoids a server/client hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return (): void => clearInterval(timer);
  }, []);

  const hour12 = settings.hour12 ?? false;

  return (
    <div className="cc-clock">
      <time className="cc-clock-time" dateTime={now ? now.toISOString() : undefined}>
        {now
          ? now.toLocaleTimeString(undefined, {
              hour12,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          : '--:--:--'}
      </time>
      <p className="cc-clock-date">
        {now
          ? now.toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : ' '}
      </p>
    </div>
  );
}
