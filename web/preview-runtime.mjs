// The JavaScript environment the transpiled ABAP runtime expects, prepared
// before that runtime is imported (preview-backend.mjs imports this first).
//
// The generated CL_SYSTEM_UUID reaches for window.crypto; a service worker has
// the same object on its own global under another name.
globalThis.window ??= globalThis;

// GET TIME STAMP / sy-datum reach the JavaScript Date. Pinning it makes two
// builds of the same code answer with the same bytes, which is what makes
// screenshot diffs between deployments readable.
export const PREVIEW_INSTANT = Date.parse("2026-09-12T10:00:00Z");
const RealDate = Date;
class PreviewDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(PREVIEW_INSTANT);
      return;
    }
    super(...args);
  }

  static now() {
    return PREVIEW_INSTANT;
  }
}
globalThis.Date = PreviewDate;
