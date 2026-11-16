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

// jsdom has no layout: Range lacks getClientRects/getBoundingClientRect,
// which ProseMirror (the journal editor) calls when it scrolls the caret
// into view. Empty geometry is enough for tests.
if (typeof Range !== 'undefined') {
  const emptyRect = (): DOMRect =>
    ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 }) as DOMRect;
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function getClientRects(): DOMRectList {
      return Object.assign([], { item: () => null }) as unknown as DOMRectList;
    };
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = emptyRect;
  }
}
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = (): Element | null => null;
}
