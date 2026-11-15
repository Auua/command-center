import { describe, expect, it } from 'vitest';
import { exampleTranslation } from './example-translation';

describe('exampleTranslation', () => {
  it('prefers Finnish', () => {
    expect(exampleTranslation({ fi: 'Hävisin.', en: 'I lost.' })).toEqual({
      text: 'Hävisin.',
      lang: 'fi',
    });
  });

  it('falls back to English', () => {
    expect(exampleTranslation({ fi: null, en: 'I lost.' })).toEqual({
      text: 'I lost.',
      lang: 'en',
    });
  });

  it('is null when neither exists (also for responses without an en field)', () => {
    expect(exampleTranslation({ fi: null, en: null })).toBeNull();
    expect(exampleTranslation({ fi: null })).toBeNull();
  });
});
