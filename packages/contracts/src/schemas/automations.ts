import { z } from 'zod';

/**
 * Automation — a user-defined reminder (ADR §4.4 `automations`, ADR-015/039;
 * owned by AutomationModule). Two kinds: `recurring` (a structured schedule
 * descriptor, compiled server-side to a cron expression — raw cron never
 * crosses the wire) and `event` ("after finishing a task"). Actions are
 * notify-only in v1 (ADR §5.3); titles/bodies are short plain text because
 * they are visible on the lock screen (§5.2).
 */
export const AUTOMATION_KINDS = ['recurring', 'event'] as const;
export const AutomationKindSchema = z.enum(AUTOMATION_KINDS);
export type AutomationKind = z.infer<typeof AutomationKindSchema>;

/** Event keys the builder may subscribe to (grows with new domain events). */
export const EVENT_KEYS = ['task.completed'] as const;
export const EventKeySchema = z.enum(EVENT_KEYS);
export type EventKey = z.infer<typeof EventKeySchema>;

// Allowed `interval` periods. Every value divides evenly into an hour or a
// day — a cron "every 7 minutes" resets at each hour boundary and lies about
// its own period, so arbitrary minute counts are rejected at the contract
// layer.
export const EVERY_MINUTES_OPTIONS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720] as const;

const EveryMinutesSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
  z.literal(30),
  z.literal(60),
  z.literal(120),
  z.literal(180),
  z.literal(240),
  z.literal(360),
  z.literal(480),
  z.literal(720),
]);
export type EveryMinutes = z.infer<typeof EveryMinutesSchema>;

const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm');

/** ISO 8601 weekday: 1 = Monday … 7 = Sunday. */
const IsoWeekdaySchema = z.number().int().min(1).max(7);

/**
 * The structured, user-editable schedule descriptor (`automations.schedule`
 * jsonb — the edit UI's source of truth; the API compiles it to `cron_expr`,
 * ADR-015). Weekly days are deduped and sorted so equal schedules compile to
 * equal cron expressions.
 */
export const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), time: TimeOfDaySchema }).strict(),
  z
    .object({
      type: z.literal('weekly'),
      time: TimeOfDaySchema,
      days: z
        .array(IsoWeekdaySchema)
        .min(1)
        .max(7)
        .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    })
    .strict(),
  z.object({ type: z.literal('interval'), everyMinutes: EveryMinutesSchema }).strict(),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

// Lock-screen-safe plain text (§5.2): no control characters; the body may
// contain newlines, the single-line title may not.
// eslint-disable-next-line no-control-regex
const SINGLE_LINE = /^[^\u0000-\u001f\u007f]*$/;
// eslint-disable-next-line no-control-regex
const MULTI_LINE = /^[^\u0000-\u0009\u000b-\u001f\u007f]*$/;

export const AutomationActionSchema = z
  .object({
    type: z.literal('notify'),
    title: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(SINGLE_LINE, 'title must be single-line plain text'),
    body: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(MULTI_LINE, 'body must be plain text')
      .nullable()
      .default(null),
  })
  .strict();
export type AutomationAction = z.infer<typeof AutomationActionSchema>;

export const AutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: AutomationKindSchema,
  schedule: ScheduleSchema.nullable(),
  eventKey: EventKeySchema.nullable(),
  action: AutomationActionSchema,
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationListResponseSchema = z.object({
  items: z.array(AutomationSchema),
});
export type AutomationListResponse = z.infer<typeof AutomationListResponseSchema>;

const NameSchema = z.string().trim().min(1).max(120);

/**
 * Write-path schemas reject unknown top-level fields in the contract
 * (ADR §5.2). Cross-field shape is enforced here too, mirroring the DB CHECK
 * constraints: a recurring automation carries a schedule and no eventKey; an
 * event automation the reverse.
 */
export const CreateAutomationRequestSchema = z
  .object({
    name: NameSchema,
    kind: AutomationKindSchema,
    schedule: ScheduleSchema.optional(),
    eventKey: EventKeySchema.optional(),
    action: AutomationActionSchema,
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'recurring') {
      if (value.schedule === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule'],
          message: 'A recurring automation requires a schedule',
        });
      }
      if (value.eventKey !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['eventKey'],
          message: 'A recurring automation cannot have an eventKey',
        });
      }
    } else {
      if (value.eventKey === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['eventKey'],
          message: 'An event automation requires an eventKey',
        });
      }
      if (value.schedule !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule'],
          message: 'An event automation cannot have a schedule',
        });
      }
    }
  });
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequestSchema>;

/**
 * Partial update; `{ enabled }` is the widget's toggle path (ADR-015). `kind`
 * is immutable — the service rejects a schedule on an event automation (and
 * an eventKey on a recurring one) with a 400.
 */
export const UpdateAutomationRequestSchema = z
  .object({
    name: NameSchema,
    schedule: ScheduleSchema,
    eventKey: EventKeySchema,
    action: AutomationActionSchema,
    enabled: z.boolean(),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Update must change at least one field',
  });
export type UpdateAutomationRequest = z.infer<typeof UpdateAutomationRequestSchema>;

/**
 * Run statuses. `pending` (claimed, outcome not yet written) is
 * internal-transient (ADR-039): it appears in run history but never as a
 * today-slot status — the today view shows "no outcome yet" by omitting
 * `run`.
 */
export const AUTOMATION_RUN_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export const AutomationRunStatusSchema = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

export const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  /** The occurrence this run belongs to — a UTC instant, unambiguous across DST. */
  slot: z.string().datetime(),
  status: AutomationRunStatusSchema,
  firedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const AutomationRunListResponseSchema = z.object({
  items: z.array(AutomationRunSchema),
});
export type AutomationRunListResponse = z.infer<typeof AutomationRunListResponseSchema>;

/** `?limit=` for GET /automations/:id/runs. */
export const AutomationRunsLimitSchema = z.coerce.number().int().min(1).max(100).default(20);

const TodayRunSchema = z.object({
  status: z.enum(['sent', 'failed', 'skipped']),
  firedAt: z.string().datetime().nullable(),
});
export type TodayRun = z.infer<typeof TodayRunSchema>;

/**
 * GET /automations/today (ADR-015 verbatim): server-expanded occurrence slots
 * for the user's local day, in the user's stored timezone. `at` is an ISO
 * datetime with the user-timezone offset. Slots without a `run` have no
 * outcome yet (future, or claimed-pending).
 */
export const TodaySlotSchema = z.object({
  automationId: z.string().uuid(),
  name: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  enabled: z.boolean(),
  run: TodayRunSchema.optional(),
});
export type TodaySlot = z.infer<typeof TodaySlotSchema>;

export const TodayEventAutomationSchema = z.object({
  automationId: z.string().uuid(),
  name: z.string().min(1),
  eventKey: EventKeySchema,
  enabled: z.boolean(),
  lastRun: TodayRunSchema.optional(),
});
export type TodayEventAutomation = z.infer<typeof TodayEventAutomationSchema>;

export const TodayResponseSchema = z.object({
  slots: z.array(TodaySlotSchema),
  events: z.array(TodayEventAutomationSchema),
});
export type TodayResponse = z.infer<typeof TodayResponseSchema>;

/**
 * Starter templates (GET /automations/templates) — a static server-side list
 * so copy and schedules version with the API, not the bundle (ADR-015).
 */
export const AutomationTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal('recurring'),
  schedule: ScheduleSchema,
  action: AutomationActionSchema,
});
export type AutomationTemplate = z.infer<typeof AutomationTemplateSchema>;

export const AutomationTemplateListResponseSchema = z.object({
  items: z.array(AutomationTemplateSchema),
});
export type AutomationTemplateListResponse = z.infer<typeof AutomationTemplateListResponseSchema>;
