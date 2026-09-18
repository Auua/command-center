import { buildOriginMatcher, parseCorsOrigins } from './cors-origins';

describe('parseCorsOrigins', () => {
  it('splits on commas and drops blanks', () => {
    expect(parseCorsOrigins(' http://localhost:3000, https://a.example ,, ')).toEqual([
      'http://localhost:3000',
      'https://a.example',
    ]);
  });
});

describe('buildOriginMatcher', () => {
  const matches = buildOriginMatcher([
    'https://command-center-web.vercel.app',
    'https://command-center-web-*-auuas-projects.vercel.app',
  ]);

  it('matches an exact origin', () => {
    expect(matches('https://command-center-web.vercel.app')).toBe(true);
  });

  it('matches a Vercel preview origin through the glob', () => {
    expect(matches('https://command-center-web-git-phase3-sdk-auuas-projects.vercel.app')).toBe(
      true,
    );
    expect(matches('https://command-center-web-abc123-auuas-projects.vercel.app')).toBe(true);
  });

  it('never lets the glob cross a dot, slash, or scheme', () => {
    expect(matches('https://command-center-web-x.evil.com-auuas-projects.vercel.app')).toBe(false);
    expect(matches('https://evil.com/command-center-web-x-auuas-projects.vercel.app')).toBe(false);
    expect(matches('http://command-center-web-x-auuas-projects.vercel.app')).toBe(false);
    expect(matches('https://command-center-web--auuas-projects.vercel.app')).toBe(false);
  });

  it('treats a plain entry literally (no regex metacharacters leak)', () => {
    const exact = buildOriginMatcher(['https://a.example']);
    expect(exact('https://aXexample')).toBe(false);
  });
});
