import { describe, expect, it } from 'vitest';
import { derivePermissionUx, type PermissionUxInput } from './permission-state';

function input(overrides: Partial<PermissionUxInput>): PermissionUxInput {
  return {
    supported: true,
    permission: 'default',
    isIos: false,
    isStandalone: false,
    hasEnabledTimedAutomation: true,
    dismissed: false,
    ...overrides,
  };
}

describe('derivePermissionUx', () => {
  it('stays hidden with no enabled timed automation, whatever else holds', () => {
    const variants: Partial<PermissionUxInput>[] = [
      {},
      { permission: 'denied' },
      { supported: false },
      { isIos: true },
    ];
    for (const variant of variants) {
      expect(derivePermissionUx(input({ ...variant, hasEnabledTimedAutomation: false }))).toBe(
        'hidden',
      );
    }
  });

  it('prompts via the banner when supported and permission is default', () => {
    expect(derivePermissionUx(input({}))).toBe('prompt-banner');
  });

  it('hides the banner once dismissed (prompt only — badges are unaffected)', () => {
    expect(derivePermissionUx(input({ dismissed: true }))).toBe('hidden');
    expect(derivePermissionUx(input({ dismissed: true, permission: 'denied' }))).toBe(
      'in-app-only',
    );
  });

  it('is hidden once granted', () => {
    expect(derivePermissionUx(input({ permission: 'granted' }))).toBe('hidden');
  });

  it('shows the in-app-only badge when denied', () => {
    expect(derivePermissionUx(input({ permission: 'denied' }))).toBe('in-app-only');
  });

  it('shows the in-app-only badge when push is unsupported', () => {
    expect(derivePermissionUx(input({ supported: false }))).toBe('in-app-only');
  });

  it('hints at installing on iOS outside a standalone PWA (R4)', () => {
    expect(derivePermissionUx(input({ isIos: true }))).toBe('ios-install-hint');
    // Even when the browser claims no support / permission was denied — the
    // install hint is the actionable path on iOS.
    expect(derivePermissionUx(input({ isIos: true, supported: false }))).toBe('ios-install-hint');
    expect(derivePermissionUx(input({ isIos: true, permission: 'denied' }))).toBe(
      'ios-install-hint',
    );
  });

  it('treats an installed iOS PWA like any other browser', () => {
    expect(derivePermissionUx(input({ isIos: true, isStandalone: true }))).toBe('prompt-banner');
    expect(
      derivePermissionUx(input({ isIos: true, isStandalone: true, permission: 'granted' })),
    ).toBe('hidden');
    expect(
      derivePermissionUx(input({ isIos: true, isStandalone: true, permission: 'denied' })),
    ).toBe('in-app-only');
  });
});
