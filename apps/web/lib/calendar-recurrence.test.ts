import { describe, expect, it } from 'vitest';
import {
  describeRepeat,
  formFromRrule,
  NO_REPEAT,
  rruleFromForm,
  type RepeatForm,
} from './calendar-recurrence';

const form = (over: Partial<RepeatForm>): RepeatForm => ({ ...NO_REPEAT, ...over });

describe('rruleFromForm', () => {
  it('writes nothing for "doesn’t repeat"', () => {
    expect(rruleFromForm(NO_REPEAT, '2026-11-17')).toBeNull();
  });

  it('writes the frequency, the interval when above one, and the end', () => {
    expect(rruleFromForm(form({ frequency: 'daily' }), '2026-11-17')).toBe('FREQ=DAILY');
    expect(
      rruleFromForm(
        form({ frequency: 'monthly', interval: 3, end: { kind: 'count', count: 4 } }),
        '2026-11-17',
      ),
    ).toBe('FREQ=MONTHLY;INTERVAL=3;COUNT=4');
    expect(
      rruleFromForm(
        form({ frequency: 'yearly', end: { kind: 'until', date: '2030-12-31' } }),
        '2026-11-17',
      ),
    ).toBe('FREQ=YEARLY;UNTIL=20301231T235959Z');
  });

  it('writes weekly days in order, defaulting to the start’s weekday', () => {
    expect(rruleFromForm(form({ frequency: 'weekly', weekdays: [4, 2, 2] }), '2026-11-17')).toBe(
      'FREQ=WEEKLY;BYDAY=TU,TH',
    );
    // 2026-11-17 is a Tuesday.
    expect(rruleFromForm(form({ frequency: 'weekly' }), '2026-11-17')).toBe('FREQ=WEEKLY;BYDAY=TU');
  });
});

describe('formFromRrule', () => {
  it('round-trips everything the dialog writes', () => {
    const forms: RepeatForm[] = [
      form({ frequency: 'daily', interval: 2 }),
      form({ frequency: 'weekly', weekdays: [1, 3, 5], end: { kind: 'count', count: 10 } }),
      form({ frequency: 'monthly', end: { kind: 'until', date: '2027-06-30' } }),
      form({ frequency: 'yearly' }),
    ];
    for (const original of forms) {
      expect(formFromRrule(rruleFromForm(original, '2026-11-16'))).toEqual(original);
    }
    expect(formFromRrule(null)).toEqual(NO_REPEAT);
  });

  it('calls anything else custom', () => {
    expect(formFromRrule('FREQ=MONTHLY;BYDAY=2TU')).toBe('custom');
    expect(formFromRrule('FREQ=WEEKLY;BYDAY=1MO')).toBe('custom');
    expect(formFromRrule('FREQ=HOURLY')).toBe('custom');
    expect(formFromRrule('FREQ=DAILY;BYHOUR=9')).toBe('custom');
    expect(formFromRrule('FREQ=DAILY;COUNT=2;UNTIL=20270101')).toBe('custom');
    expect(formFromRrule('FREQ=DAILY;INTERVAL=0')).toBe('custom');
  });
});

describe('describeRepeat', () => {
  it('reads a rule back in words', () => {
    expect(describeRepeat(NO_REPEAT)).toBe('Doesn’t repeat');
    expect(describeRepeat(form({ frequency: 'daily' }))).toBe('Every day');
    expect(
      describeRepeat(
        form({
          frequency: 'weekly',
          interval: 2,
          weekdays: [0, 4, 2],
          end: { kind: 'until', date: '2026-12-31' },
        }),
      ),
    ).toBe('Every 2 weeks on Tue, Thu, Sun · until 31 Dec 2026');
    expect(describeRepeat(form({ frequency: 'yearly', end: { kind: 'count', count: 5 } }))).toBe(
      'Every year · 5 times',
    );
    expect(describeRepeat('custom')).toBe('Custom repeat (kept as it is)');
  });
});
