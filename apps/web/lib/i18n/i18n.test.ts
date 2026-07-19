import { describe, expect, it } from 'vitest';
import { t } from './index';
import { messages } from './messages.en';

describe('t', () => {
  it('returns the catalog message for a key', () => {
    expect(t('shell.loadingDashboard')).toBe('Loading dashboard…');
  });

  it('interpolates {param} placeholders', () => {
    expect(t('shell.unknownWidget', { id: 'pomodoro' })).toBe(
      'Unknown widget "pomodoro". It may have been removed or not registered yet.',
    );
  });

  it('leaves unknown placeholders verbatim so typos stay visible', () => {
    expect(t('shell.unknownWidget', { wrongName: 'x' })).toContain('{id}');
  });

  it('has no empty messages in the catalog', () => {
    for (const [key, value] of Object.entries(messages)) {
      expect(value, `message for ${key}`).not.toBe('');
    }
  });
});
