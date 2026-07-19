// Registers jest-dom matchers (toBeInTheDocument, …) on vitest's expect.
import '@testing-library/jest-dom/vitest';

// jsdom historically ships <dialog> without the imperative API. Polyfill
// show()/showModal()/close() defensively (only when missing) so native
// <dialog> components — e.g. the reminders builder modal — are testable.
// Minimal semantics: toggle `open`, set returnValue, fire a `close` event.
const dialogProto =
  typeof HTMLDialogElement !== 'undefined' ? HTMLDialogElement.prototype : undefined;

if (dialogProto && typeof dialogProto.showModal !== 'function') {
  dialogProto.show = function show(this: HTMLDialogElement): void {
    this.open = true;
  };
  dialogProto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  dialogProto.close = function close(this: HTMLDialogElement, returnValue?: string): void {
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
