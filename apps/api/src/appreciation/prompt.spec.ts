import { localDateIn, pickPrompt, promptText } from './prompt';

const PROMPTS = [{ id: 'smile' }, { id: 'body' }, { id: 'comfort' }, { id: 'learned' }];
const USER = '00000000-0000-0000-0000-0000000000aa';

describe('localDateIn', () => {
  // 2026-11-15 23:30 UTC is already the 16th in Helsinki (UTC+2) and still
  // the 15th in New York (UTC-5).
  const now = new Date('2026-11-15T23:30:00Z');

  it('formats the local day in the given timezone', () => {
    expect(localDateIn('UTC', now)).toBe('2026-11-15');
    expect(localDateIn('Europe/Helsinki', now)).toBe('2026-11-16');
    expect(localDateIn('America/New_York', now)).toBe('2026-11-15');
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(localDateIn('Not/AZone', now)).toBe('2026-11-15');
  });
});

describe('pickPrompt', () => {
  it('is the same all day for a user, whatever order the prompts arrive in', () => {
    const first = pickPrompt(PROMPTS, USER, '2026-11-15');
    const shuffled = pickPrompt([...PROMPTS].reverse(), USER, '2026-11-15');
    expect(first).not.toBeNull();
    expect(shuffled?.id).toBe(first?.id);
  });

  it('moves on across days and differs between users', () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const picks = new Set(days.map((day) => pickPrompt(PROMPTS, USER, day)?.id));
    expect(picks.size).toBeGreaterThan(1);
    const otherUser = days.map(
      (day) => pickPrompt(PROMPTS, '00000000-0000-0000-0000-0000000000bb', day)?.id,
    );
    expect(otherUser).not.toEqual(days.map((day) => pickPrompt(PROMPTS, USER, day)?.id));
  });

  it('answers null when no prompt is active', () => {
    expect(pickPrompt([], USER, '2026-11-15')).toBeNull();
  });
});

describe('promptText', () => {
  it('uses the requested locale, else English', () => {
    const text = { en: 'What made you smile today?', fi: 'Mikä sai sinut hymyilemään tänään?' };
    expect(promptText(text, 'fi')).toBe(text.fi);
    expect(promptText(text, 'ja')).toBe(text.en);
    expect(promptText({ en: '  ' }, 'en')).toBeNull();
    expect(promptText({}, 'en')).toBeNull();
  });
});
