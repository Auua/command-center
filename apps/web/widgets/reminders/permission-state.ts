/**
 * Pure push-permission UX state machine (ADR-015 delivery-state rules).
 * The widget derives one of four surfaces from environment facts — the
 * decision logic is fully unit-testable with no browser APIs.
 */

export type PermissionUx = 'hidden' | 'prompt-banner' | 'in-app-only' | 'ios-install-hint';

export interface PermissionUxInput {
  /** supportsPush(): SW + PushManager + Notification all present. */
  supported: boolean;
  /** Notification.permission ('default' until asked). */
  permission: NotificationPermission;
  isIos: boolean;
  isStandalone: boolean;
  /** Banner only earns space when a timed reminder is actually enabled. */
  hasEnabledTimedAutomation: boolean;
  /** The prompt banner was dismissed (persisted); only hides the prompt. */
  dismissed: boolean;
}

export function derivePermissionUx(input: PermissionUxInput): PermissionUx {
  if (!input.hasEnabledTimedAutomation) return 'hidden';

  // iOS grants push only to installed PWAs (R4): in a plain Safari tab the
  // permission prompt is pointless — hint at installing instead.
  if (input.isIos && !input.isStandalone) return 'ios-install-hint';

  if (!input.supported) return 'in-app-only';

  switch (input.permission) {
    case 'granted':
      return 'hidden';
    case 'denied':
      return 'in-app-only';
    default:
      return input.dismissed ? 'hidden' : 'prompt-banner';
  }
}
