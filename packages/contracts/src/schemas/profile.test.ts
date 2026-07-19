import { describe, expect, it } from 'vitest';
import { isValidIanaTimeZone, ProfileSchema, UpdateProfileRequestSchema } from './profile';

describe('isValidIanaTimeZone', () => {
  // 'EET' is a legacy-but-real tz-database zone; Intl (and the evaluator's
  // luxon/cron-parser stack) accept it, so the contract does too.
  it.each(['UTC', 'Europe/Helsinki', 'Asia/Tokyo', 'America/New_York', 'EET'])(
    'accepts %s',
    (timezone) => {
      expect(isValidIanaTimeZone(timezone)).toBe(true);
    },
  );

  it.each(['Europe/Helsinky', 'UTC+3', 'not a zone', ''])('rejects %s', (timezone) => {
    expect(isValidIanaTimeZone(timezone)).toBe(false);
  });
});

describe('ProfileSchema / UpdateProfileRequestSchema', () => {
  it('accepts a valid IANA timezone', () => {
    expect(ProfileSchema.parse({ timezone: 'Europe/Helsinki' })).toEqual({
      timezone: 'Europe/Helsinki',
    });
    expect(UpdateProfileRequestSchema.parse({ timezone: 'UTC' })).toEqual({ timezone: 'UTC' });
  });

  it('rejects invalid timezones and unknown fields', () => {
    expect(UpdateProfileRequestSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ timezone: 'UTC', admin: true }).success).toBe(
      false,
    );
    expect(UpdateProfileRequestSchema.safeParse({}).success).toBe(false);
  });
});
