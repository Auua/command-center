import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relative-time';

const NOW = new Date('2026-07-19T12:00:00Z');

describe('formatRelativeTime', () => {
  it('says "now" within a minute', () => {
    expect(formatRelativeTime('2026-07-19T11:59:30Z', NOW, 'en-US').toLowerCase()).toContain('now');
  });

  it('uses minutes under an hour', () => {
    expect(formatRelativeTime('2026-07-19T11:55:00Z', NOW, 'en-US')).toMatch(/5/);
  });

  it('uses hours under a day', () => {
    expect(formatRelativeTime('2026-07-19T09:00:00Z', NOW, 'en-US')).toMatch(/3/);
  });

  it('uses days under a week', () => {
    expect(formatRelativeTime('2026-07-17T12:00:00Z', NOW, 'en-US').toLowerCase()).toMatch(/2|day/);
  });

  it('falls back to a date beyond a week', () => {
    const result = formatRelativeTime('2026-06-01T12:00:00Z', NOW, 'en-US');
    expect(result).toMatch(/2026|6|Jun/i);
  });

  it('passes through unparseable input', () => {
    expect(formatRelativeTime('not-a-date', NOW, 'en-US')).toBe('not-a-date');
  });
});
