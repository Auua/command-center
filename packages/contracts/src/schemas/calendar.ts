import { z } from 'zod';

/**
 * Calendar (ADR-018): the user's own events in Postgres `calendar_events`,
 * owned by CalendarModule. Timed events are instants rendered in the home
 * timezone; all-day events are plain dates that never pass through a
 * timezone. Recurring series carry an RFC 5545 RRULE that only the server
 * expands — clients read concrete occurrences.
 */

export const CALENDAR_TITLE_MAX = 200;
export const CALENDAR_LOCATION_MAX = 200;
export const CALENDAR_NOTE_MAX = 2000;
export const CALENDAR_RRULE_MAX = 300;
/** `GET /calendar/events` — the widest range one request may ask for. */
export const CALENDAR_RANGE_MAX_DAYS = 366;
/** …and the most occurrences it may return (else 400 "narrow the range"). */
export const CALENDAR_OCCURRENCES_MAX = 500;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const instant = z.string().datetime({ offset: true });
const optionalText = (max: number): z.ZodType<string | null, z.ZodTypeDef, unknown> =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** Days between two YYYY-MM-DD dates (`to` − `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── Writes ─────────────────────────────────────────────────────────────────

const common = {
  title: z.string().trim().min(1).max(CALENDAR_TITLE_MAX),
  location: optionalText(CALENDAR_LOCATION_MAX),
  note: optionalText(CALENDAR_NOTE_MAX),
  /**
   * The series rule without DTSTART (the event's start is the series
   * start), e.g. `FREQ=WEEKLY;BYDAY=TU`. The server parses it with the
   * library it expands with and refuses what it can't expand.
   */
  rrule: z
    .string()
    .trim()
    .max(CALENDAR_RRULE_MAX)
    .nullish()
    .transform((value) => (value ? value.replace(/^RRULE:/i, '') : null)),
};

const TimedWriteSchema = z
  .object({ allDay: z.literal(false), startsAt: instant, endsAt: instant, ...common })
  .strict();
const AllDayWriteSchema = z
  .object({ allDay: z.literal(true), startsOn: isoDate, endsOn: isoDate, ...common })
  .strict();

/**
 * `POST /calendar/events`, and `PATCH /calendar/events/:id` — the edit
 * dialog sends the whole event (or the whole series) every time.
 */
export const CalendarEventWriteSchema = z
  .discriminatedUnion('allDay', [TimedWriteSchema, AllDayWriteSchema])
  .superRefine((event, ctx) => {
    if (!event.allDay && Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Ends before it starts' });
    }
    if (event.allDay && event.endsOn < event.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Ends before it starts' });
    }
  });
export type CalendarEventWrite = z.input<typeof CalendarEventWriteSchema>;
export type CalendarEventWriteParsed = z.output<typeof CalendarEventWriteSchema>;

// ── Reads ──────────────────────────────────────────────────────────────────

const timing = z.discriminatedUnion('allDay', [
  z.object({ allDay: z.literal(false), startsAt: instant, endsAt: instant }),
  /** Inclusive: a one-day event has `endsOn === startsOn`. */
  z.object({ allDay: z.literal(true), startsOn: isoDate, endsOn: isoDate }),
]);

/** `GET /calendar/events/:id` — the stored series, for the edit dialog. */
export const CalendarEventSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    location: z.string().nullable(),
    note: z.string().nullable(),
    rrule: z.string().nullable(),
    /** Skipped occurrences, by `occurrenceStart`. */
    exdates: z.array(z.string()),
    /** The timezone a timed series repeats in (its wall-clock time stays put). */
    timeZone: z.string(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .and(timing);
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

/** One concrete occurrence — a single event, or one instance of a series. */
export const CalendarOccurrenceSchema = z
  .object({
    seriesId: z.string().uuid(),
    /**
     * This instance's start, as its key: an ISO instant (UTC, ms) for a
     * timed event, a YYYY-MM-DD date for an all-day one.
     */
    occurrenceStart: z.string(),
    isRecurring: z.boolean(),
    title: z.string(),
    location: z.string().nullable(),
    note: z.string().nullable(),
  })
  .and(timing);
export type CalendarOccurrence = z.infer<typeof CalendarOccurrenceSchema>;

/**
 * `GET /calendar/events?from&to` — dates in the home timezone, `to`
 * exclusive, at most CALENDAR_RANGE_MAX_DAYS apart.
 */
export const CalendarRangeQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .superRefine((range, ctx) => {
    const days = daysBetween(range.from, range.to);
    if (days < 1)
      ctx.addIssue({ code: 'custom', path: ['to'], message: '`to` must be after `from`' });
    if (days > CALENDAR_RANGE_MAX_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `At most ${CALENDAR_RANGE_MAX_DAYS} days per request`,
      });
    }
  });
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuerySchema>;

export const CalendarRangeResponseSchema = z.object({
  /** The home timezone the range was read in — render timed events in it. */
  timeZone: z.string(),
  from: isoDate,
  to: isoDate,
  /** Chronological; all-day before timed on the same day. */
  occurrences: z.array(CalendarOccurrenceSchema),
});
export type CalendarRangeResponse = z.infer<typeof CalendarRangeResponseSchema>;
