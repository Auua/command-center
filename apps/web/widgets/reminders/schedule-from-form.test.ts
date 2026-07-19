import { describe, expect, it } from 'vitest';
import { ScheduleSchema } from '@command-center/contracts';
import { formFromSchedule, scheduleFromForm, type TimedScheduleForm } from './schedule-from-form';

function form(overrides: Partial<TimedScheduleForm>): TimedScheduleForm {
  return { time: '08:30', dayChoice: 'every-day', customDays: [], ...overrides };
}

describe('scheduleFromForm', () => {
  it('maps every-day to a daily schedule', () => {
    expect(scheduleFromForm(form({ dayChoice: 'every-day' }))).toEqual({
      ok: true,
      schedule: { type: 'daily', time: '08:30' },
    });
  });

  it('maps weekdays to weekly Mon–Fri', () => {
    expect(scheduleFromForm(form({ dayChoice: 'weekdays' }))).toEqual({
      ok: true,
      schedule: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] },
    });
  });

  it('maps weekends to weekly Sat–Sun', () => {
    expect(scheduleFromForm(form({ dayChoice: 'weekends' }))).toEqual({
      ok: true,
      schedule: { type: 'weekly', time: '08:30', days: [6, 7] },
    });
  });

  it('sorts and dedupes custom days', () => {
    expect(scheduleFromForm(form({ dayChoice: 'custom', customDays: [5, 1, 3, 5, 1] }))).toEqual({
      ok: true,
      schedule: { type: 'weekly', time: '08:30', days: [1, 3, 5] },
    });
  });

  it('drops out-of-range custom days instead of sending them to the API', () => {
    expect(scheduleFromForm(form({ dayChoice: 'custom', customDays: [0, 2, 8, 4.5] }))).toEqual({
      ok: true,
      schedule: { type: 'weekly', time: '08:30', days: [2] },
    });
  });

  it('normalizes all seven custom days to daily', () => {
    expect(
      scheduleFromForm(form({ dayChoice: 'custom', customDays: [7, 6, 5, 4, 3, 2, 1] })),
    ).toEqual({ ok: true, schedule: { type: 'daily', time: '08:30' } });
  });

  it('rejects an empty custom selection', () => {
    expect(scheduleFromForm(form({ dayChoice: 'custom', customDays: [] }))).toEqual({
      ok: false,
      error: 'no-days',
    });
  });

  it('rejects a custom selection that is entirely out of range', () => {
    expect(scheduleFromForm(form({ dayChoice: 'custom', customDays: [0, 8, -1] }))).toEqual({
      ok: false,
      error: 'no-days',
    });
  });

  it.each(['', '8:30', '24:00', '12:60', 'noon', '1230'])('rejects invalid time %j', (time) => {
    expect(scheduleFromForm(form({ time }))).toEqual({ ok: false, error: 'invalid-time' });
  });

  it.each(['00:00', '09:05', '23:59'])('accepts boundary time %s', (time) => {
    const result = scheduleFromForm(form({ time }));
    expect(result.ok).toBe(true);
  });

  it('always produces a schedule the contract accepts', () => {
    const cases: TimedScheduleForm[] = [
      form({ dayChoice: 'every-day' }),
      form({ dayChoice: 'weekdays' }),
      form({ dayChoice: 'weekends' }),
      form({ dayChoice: 'custom', customDays: [2, 4] }),
      form({ dayChoice: 'custom', customDays: [1, 2, 3, 4, 5, 6, 7] }),
    ];
    for (const input of cases) {
      const result = scheduleFromForm(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(ScheduleSchema.safeParse(result.schedule).success).toBe(true);
      }
    }
  });
});

describe('formFromSchedule', () => {
  it('round-trips daily', () => {
    expect(formFromSchedule({ type: 'daily', time: '07:15' })).toEqual({
      time: '07:15',
      dayChoice: 'every-day',
      customDays: [],
    });
  });

  it('recognizes weekly Mon–Fri as the weekdays choice', () => {
    expect(formFromSchedule({ type: 'weekly', time: '07:15', days: [1, 2, 3, 4, 5] })).toEqual({
      time: '07:15',
      dayChoice: 'weekdays',
      customDays: [],
    });
  });

  it('recognizes weekly Sat–Sun as the weekends choice', () => {
    expect(formFromSchedule({ type: 'weekly', time: '07:15', days: [6, 7] })).toEqual({
      time: '07:15',
      dayChoice: 'weekends',
      customDays: [],
    });
  });

  it('maps other weekly day sets to custom (sorted)', () => {
    expect(formFromSchedule({ type: 'weekly', time: '07:15', days: [7, 2] })).toEqual({
      time: '07:15',
      dayChoice: 'custom',
      customDays: [2, 7],
    });
  });

  it('normalizes a weekly schedule covering all days to every-day', () => {
    expect(
      formFromSchedule({ type: 'weekly', time: '07:15', days: [1, 2, 3, 4, 5, 6, 7] }),
    ).toEqual({ time: '07:15', dayChoice: 'every-day', customDays: [] });
  });

  it('returns null for interval schedules (read-only in the v1 builder)', () => {
    expect(formFromSchedule({ type: 'interval', everyMinutes: 30 })).toBeNull();
  });

  it('round-trips every producible schedule back to an equivalent form', () => {
    const forms: TimedScheduleForm[] = [
      form({ dayChoice: 'every-day' }),
      form({ dayChoice: 'weekdays' }),
      form({ dayChoice: 'weekends' }),
      form({ dayChoice: 'custom', customDays: [3, 6] }),
    ];
    for (const input of forms) {
      const built = scheduleFromForm(input);
      expect(built.ok).toBe(true);
      if (built.ok) {
        const roundTripped = formFromSchedule(built.schedule);
        expect(roundTripped).not.toBeNull();
        // Building again from the round-tripped form gives the same schedule.
        expect(scheduleFromForm(roundTripped as TimedScheduleForm)).toEqual(built);
      }
    }
  });
});
