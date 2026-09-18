import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiUrl } from './env';

describe('getApiUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('strips trailing slashes so paths never double up', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://command-center-api.vercel.app/');
    expect(getApiUrl()).toBe('https://command-center-api.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3001//');
    expect(getApiUrl()).toBe('http://localhost:3001');
  });

  it('leaves a clean value alone', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3001');
    expect(getApiUrl()).toBe('http://localhost:3001');
  });

  it('throws when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    expect(() => getApiUrl()).toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
