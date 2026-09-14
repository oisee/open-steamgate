// What an exception out of transpiled ABAP actually was.
//
// Its own module, and not part of tools/osd-apc.mjs, for one reason: the
// service worker needs it too and osd-apc imports node:crypto for the RFC
// 6455 handshake. Pulling that into a browser bundle to reach ten lines of
// string handling is the wrong trade.
//
// The thing being described is often not an Error. An ABAP exception class
// instance has no `message`, or has one that is an ABAP string object, so
// `String(error?.message ?? error)` — the obvious line, and the one this
// replaced — yields the empty string and the caller reports a failure with
// nothing in it. A channel that closes with code 1011 and no reason is how
// a crash in a Z-machine looked for an afternoon.
export function describe(error) {
  if (error === undefined || error === null) {
    return "an exception with no value";
  }
  const name = error.constructor?.INTERNAL_NAME ?? error.constructor?.name ?? "exception";
  const text = (() => {
    try {
      const raw = error.message?.get?.() ?? error.message;
      return typeof raw === "string" ? raw.trim() : "";
    } catch {
      return "";
    }
  })();
  // the frame goes on either way. An ABAP exception with no text needs it to
  // be findable at all; a JavaScript TypeError out of transpiled code needs
  // it more, because the message names a property and not a place, and
  // "cannot read properties of undefined" is the same sentence everywhere.
  const frames = (error.stack ?? "").split("\n").slice(1)
    .map((l) => l.trim())
    .filter((l) => l.includes("/output/") || l.includes("node_modules/@abaplint"))
    .slice(0, 3);
  const where = frames.length === 0 ? (error.stack?.split("\n")?.[1]?.trim() ?? "") : frames.join(" <- ");
  const body = text === "" ? `${name} (no text)` : `${name}: ${text}`;
  return where === "" ? body : `${body}\n    ${where}`;
}
