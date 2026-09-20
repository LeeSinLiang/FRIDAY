/** Presentation only: call after a confirmed demo action; never submits checkout. */
export function previewOrderDispatch() {
  window.dispatchEvent(new Event('friday:preview-order-dispatch'))
}
