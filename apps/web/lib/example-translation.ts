/**
 * The vault's inline examples carry their translation in `fi` or, for the
 * many Tofugu-sourced sentences, in `en`. The cards show one translation:
 * Finnish when it exists, English otherwise, tagged with its language so
 * screen readers switch voice.
 */
export interface ExampleTranslation {
  text: string;
  lang: 'fi' | 'en';
}

export function exampleTranslation(example: {
  fi: string | null;
  en?: string | null;
}): ExampleTranslation | null {
  if (example.fi) return { text: example.fi, lang: 'fi' };
  if (example.en) return { text: example.en, lang: 'en' };
  return null;
}
