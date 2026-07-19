import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIos, isStandalone, supportsPush } from './pwa';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const IPAD_OS_13_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
const MAC_UA = IPAD_OS_13_UA; // identical string — distinguished by touch points
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile';

function stubNavigator(overrides: Record<string, unknown>): void {
  vi.stubGlobal('navigator', { ...window.navigator, ...overrides });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isIos', () => {
  it('detects iPhone user agents', () => {
    stubNavigator({ userAgent: IPHONE_UA, maxTouchPoints: 5 });
    expect(isIos()).toBe(true);
  });

  it('detects iPadOS masquerading as macOS via touch points', () => {
    stubNavigator({ userAgent: IPAD_OS_13_UA, maxTouchPoints: 5 });
    expect(isIos()).toBe(true);
  });

  it('does not flag a real Mac (no touch points)', () => {
    stubNavigator({ userAgent: MAC_UA, maxTouchPoints: 0 });
    expect(isIos()).toBe(false);
  });

  it('does not flag Android', () => {
    stubNavigator({ userAgent: ANDROID_UA, maxTouchPoints: 5 });
    expect(isIos()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('is false when matchMedia is unavailable and no iOS flag is set (jsdom)', () => {
    expect(isStandalone()).toBe(false);
  });

  it('is true when display-mode: standalone matches', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
      })),
    );
    expect(isStandalone()).toBe(true);
  });

  it('is true under the iOS Home Screen flag', () => {
    stubNavigator({ standalone: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('supportsPush', () => {
  it('is false when the push stack is missing (jsdom has no serviceWorker)', () => {
    expect(supportsPush()).toBe(false);
  });

  it('is true when serviceWorker, PushManager and Notification all exist', () => {
    stubNavigator({ serviceWorker: {} });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('Notification', function Notification() {});
    expect(supportsPush()).toBe(true);
  });
});
