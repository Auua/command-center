/**
 * Focus return across routes (ADR-016: closing the editor returns focus to
 * the control that opened it — the widget CTA or a timeline row). The
 * opener records an element id; the page that shows that element again
 * takes it once. sessionStorage, guarded: without it, focus just isn't
 * restored.
 */
const KEY = 'cc:return-focus';

export function rememberReturnFocus(elementId: string): void {
  try {
    sessionStorage.setItem(KEY, elementId);
  } catch {
    // Storage unavailable: nothing to restore later.
  }
}

/** True (and forgotten) when `elementId` was the remembered opener. */
export function takeReturnFocus(elementId: string): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== elementId) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
