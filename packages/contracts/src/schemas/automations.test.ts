import { describe, expect, it } from 'vitest';
import {
  AutomationActionSchema,
  AutomationRunSchema,
  AutomationSchema,
  AutomationTemplateSchema,
  CreateAutomationRequestSchema,
  EVERY_MINUTES_OPTIONS,
  ScheduleSchema,
  TodayResponseSchema,
  UpdateAutomationRequestSchema,
} from './automations';

const ACTION = { type: 'notify', title: 'Hydration break', body: 'Drink some water' };

const AUTOMATION = {
  id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
  name: 'Hydration break',
  kind: 'recurring',
  schedule: { type: 'daily', time: '12:00' },
  eventKey: null,
  action: ACTION,
  enabled: true,
  createdAt: '2026-07-19T10:00:00.000Z',
  updatedAt: '2026-07-19T10:00:00.000Z',
};

describe('ScheduleSchema', () => {
  it('accepts daily, weekly, and interval descriptors', () => {
    expect(ScheduleSchema.parse({ type: 'daily', time: '09:30' })).toEqual({
      type: 'daily',
      time: '09:30',
    });
    expect(ScheduleSchema.parse({ type: 'weekly', time: '21:30', days: [1, 2, 3, 4, 5] })).toEqual({
      type: 'weekly',
      time: '21:30',
      days: [1, 2, 3, 4, 5],
    });
    expect(ScheduleSchema.parse({ type: 'interval', everyMinutes: 30 })).toEqual({
      type: 'interval',
      everyMinutes: 30,
    });
  });

  it('dedupes and sorts weekly days (equal schedules compile equal)', () => {
    expect(ScheduleSchema.parse({ type: 'weekly', time: '08:00', days: [7, 1, 7, 3] })).toEqual({
      type: 'weekly',
      time: '08:00',
      days: [1, 3, 7],
    });
  });

  it.each(EVERY_MINUTES_OPTIONS)('accepts everyMinutes %d from the allowed set', (minutes) => {
    expect(ScheduleSchema.safeParse({ type: 'interval', everyMinutes: minutes }).success).toBe(
      true,
    );
  });

  it.each([1, 7, 45, 90, 1440])('rejects everyMinutes %d outside the allowed set', (minutes) => {
    expect(ScheduleSchema.safeParse({ type: 'interval', everyMinutes: minutes }).success).toBe(
      false,
    );
  });

  it.each([
    ['24:00 time', { type: 'daily', time: '24:00' }],
    ['12:5 time', { type: 'daily', time: '12:5' }],
    ['empty weekly days', { type: 'weekly', time: '08:00', days: [] }],
    ['weekday 0', { type: 'weekly', time: '08:00', days: [0] }],
    ['weekday 8', { type: 'weekly', time: '08:00', days: [8] }],
    ['unknown type', { type: 'monthly', time: '08:00' }],
    ['extra field', { type: 'daily', time: '08:00', cron: '* * * * *' }],
  ])('rejects %s', (_label, value) => {
    expect(ScheduleSchema.safeParse(value).success).toBe(false);
  });
});

describe('AutomationActionSchema', () => {
  it('defaults body to null and trims', () => {
    expect(AutomationActionSchema.parse({ type: 'notify', title: '  Stretch  ' })).toEqual({
      type: 'notify',
      title: 'Stretch',
      body: null,
    });
  });

  it('caps title at 80 and body at 200 characters', () => {
    expect(
      AutomationActionSchema.safeParse({ type: 'notify', title: 'x'.repeat(81) }).success,
    ).toBe(false);
    expect(
      AutomationActionSchema.safeParse({ type: 'notify', title: 't', body: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });

  it('rejects control characters (lock-screen-safe plain text)', () => {
    expect(AutomationActionSchema.safeParse({ type: 'notify', title: 'two\nlines' }).success).toBe(
      false,
    );
    expect(AutomationActionSchema.safeParse({ type: 'notify', title: 'bell\u0007' }).success).toBe(
      false,
    );
    // The multi-line body may contain newlines.
    expect(
      AutomationActionSchema.safeParse({ type: 'notify', title: 't', body: 'two\nlines' }).success,
    ).toBe(true);
  });

  it('rejects non-notify actions (v1 is notify-only, ADR §5.3)', () => {
    expect(
      AutomationActionSchema.safeParse({ type: 'webhook', title: 't', url: 'https://x' }).success,
    ).toBe(false);
  });
});

describe('AutomationSchema', () => {
  it('accepts recurring and event automations', () => {
    expect(AutomationSchema.parse(AUTOMATION)).toEqual(AUTOMATION);
    const event = {
      ...AUTOMATION,
      kind: 'event',
      schedule: null,
      eventKey: 'task.completed',
    };
    expect(AutomationSchema.parse(event)).toEqual(event);
  });

  it('never carries a cron expression (server-internal, ADR-015)', () => {
    expect('cronExpr' in AutomationSchema.shape).toBe(false);
  });
});

describe('CreateAutomationRequestSchema', () => {
  it('accepts a recurring create and defaults enabled to true', () => {
    const parsed = CreateAutomationRequestSchema.parse({
      name: 'Hydration break',
      kind: 'recurring',
      schedule: { type: 'daily', time: '12:00' },
      action: ACTION,
    });
    expect(parsed.enabled).toBe(true);
  });

  it('accepts an event create with a known event key', () => {
    expect(
      CreateAutomationRequestSchema.safeParse({
        name: 'After a task',
        kind: 'event',
        eventKey: 'task.completed',
        action: ACTION,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['recurring without schedule', { name: 'n', kind: 'recurring', action: ACTION }],
    [
      'recurring with eventKey',
      {
        name: 'n',
        kind: 'recurring',
        schedule: { type: 'daily', time: '12:00' },
        eventKey: 'task.completed',
        action: ACTION,
      },
    ],
    ['event without eventKey', { name: 'n', kind: 'event', action: ACTION }],
    [
      'event with schedule',
      {
        name: 'n',
        kind: 'event',
        eventKey: 'task.completed',
        schedule: { type: 'daily', time: '12:00' },
        action: ACTION,
      },
    ],
    ['unknown event key', { name: 'n', kind: 'event', eventKey: 'day.rolled', action: ACTION }],
    [
      'kind "time" (reserved, D3)',
      { name: 'n', kind: 'time', schedule: { type: 'daily', time: '12:00' }, action: ACTION },
    ],
    [
      'unknown top-level field',
      {
        name: 'n',
        kind: 'recurring',
        schedule: { type: 'daily', time: '12:00' },
        action: ACTION,
        userId: 'someone-else',
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(CreateAutomationRequestSchema.safeParse(value).success).toBe(false);
  });

  it('caps name at 120 characters', () => {
    expect(
      CreateAutomationRequestSchema.safeParse({
        name: 'x'.repeat(121),
        kind: 'event',
        eventKey: 'task.completed',
        action: ACTION,
      }).success,
    ).toBe(false);
  });
});

describe('UpdateAutomationRequestSchema', () => {
  it('accepts the single-field toggle path', () => {
    expect(UpdateAutomationRequestSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('rejects an empty update and kind changes', () => {
    expect(UpdateAutomationRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateAutomationRequestSchema.safeParse({ kind: 'event' }).success).toBe(false);
  });
});

describe('AutomationRunSchema', () => {
  it('accepts every run status including internal-transient pending', () => {
    for (const status of ['pending', 'sent', 'failed', 'skipped']) {
      expect(
        AutomationRunSchema.safeParse({
          id: '9f8a2f10-4b6e-4b52-9c9d-1a2b3c4d5e6f',
          slot: '2026-07-19T09:00:00.000Z',
          status,
          firedAt: status === 'sent' ? '2026-07-19T09:00:04.000Z' : null,
          error: null,
          createdAt: '2026-07-19T09:00:01.000Z',
        }).success,
      ).toBe(true);
    }
  });
});

describe('TodayResponseSchema', () => {
  it('accepts the ADR-015 shape with offset datetimes', () => {
    const today = {
      slots: [
        {
          automationId: AUTOMATION.id,
          name: 'Hydration break',
          at: '2026-07-19T12:00:00.000+03:00',
          enabled: true,
          run: { status: 'sent', firedAt: '2026-07-19T09:00:04.000Z' },
        },
        {
          automationId: AUTOMATION.id,
          name: 'Hydration break',
          at: '2026-07-19T18:00:00.000+03:00',
          enabled: true,
        },
      ],
      events: [
        {
          automationId: AUTOMATION.id,
          name: 'After a task',
          eventKey: 'task.completed',
          enabled: true,
        },
      ],
    };
    expect(TodayResponseSchema.parse(today)).toEqual(today);
  });

  it('never exposes pending as a slot status (ADR-039: no outcome yet)', () => {
    expect(
      TodayResponseSchema.safeParse({
        slots: [
          {
            automationId: AUTOMATION.id,
            name: 'n',
            at: '2026-07-19T12:00:00.000+03:00',
            enabled: true,
            run: { status: 'pending', firedAt: null },
          },
        ],
        events: [],
      }).success,
    ).toBe(false);
  });
});

describe('AutomationTemplateSchema', () => {
  it('accepts a recurring starter template', () => {
    expect(
      AutomationTemplateSchema.safeParse({
        id: 'hydration',
        name: 'Hydration break',
        kind: 'recurring',
        schedule: { type: 'daily', time: '12:00' },
        action: ACTION,
      }).success,
    ).toBe(true);
  });
});
