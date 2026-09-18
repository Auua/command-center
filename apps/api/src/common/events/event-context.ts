import type { AuthenticatedUser } from '../../auth/auth.types';

/**
 * Out-of-band context passed as the second `emitAsync` argument. Event
 * payloads (packages/contracts) carry ids only; a listener that must write
 * user-owned rows (streaks, ADR-014) does so under the emitting request's
 * own JWT through this context — so no listener needs the service-role
 * carve-out (ADR-039 keeps the scheduler as its only consumer). Listeners
 * that do not need it ignore the extra argument.
 */
export interface EventContext {
  user: AuthenticatedUser;
}
