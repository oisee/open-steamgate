// What every destination of ours has to do with a CALL FUNCTION, in one
// place (backlog G.8).
//
// A destination does not return an answer. It is handed the caller's typed
// values and fills them, and the direction names are ABAP's in lower case:
// the ABAP `EXPORTING` is the module's input, `importing` / `tables` /
// `changing` are what the module gives back. `tools/rfc-replay.mjs` is the
// reference implementation of that contract.
//
// This file exists because the second destination was about to copy the
// first one's two helpers, and both of them encode a lesson that was paid
// for by a defect:
//
//   - the parameter name is matched WITHOUT CASE. The case it arrives in is
//     the runtime's business, not the contract's. Asking for `IV_COMMAND`
//     exactly gave `undefined` on every call, which fell back to a default,
//     so the ST05 screen rendered, said "off", showed no error, and every
//     button did the same thing (tools/osd-sql-trace-buffer.mjs, 2026-09-19)
//   - a value may be a typed box or a plain value, so `get()` is used when
//     it is there and not when it is not
//
// A rule about what every caller must do does not belong in a comment beside
// one of them; it belongs in the module they all import. That is the same
// rule `tools/osd-dialog-step.mjs` was extracted under, for the same reason.
import {fromJson} from "./rfc-replay.mjs";

/** one importing value of the call, by name, whatever case it arrived in */
export function given(signature, param) {
  const box = signature?.exporting ?? signature?.EXPORTING ?? {};
  const key = Object.keys(box).find((k) => k.toLowerCase() === String(param).toLowerCase());
  const value = key === undefined ? undefined : box[key];
  return value === undefined ? undefined : (typeof value?.get === "function" ? value.get() : value);
}

/** the string of an importing value, trimmed, or a default when it is absent */
export function givenText(signature, param, fallback = "") {
  const value = given(signature, param);
  return value === undefined ? fallback : String(value).trim();
}

/**
 * Fill the caller's exporting parameters and tables from one flat object
 * keyed by parameter name. A key the caller did not declare is silently not
 * assigned -- the signature is the contract, so a module that answers more
 * than this caller asked for is not an error.
 */
export function fill(signature, answer) {
  for (const direction of ["importing", "tables", "changing"]) {
    for (const [param, value] of Object.entries(signature?.[direction] ?? {})) {
      const out = answer[param.toUpperCase()] ?? answer[param];
      if (out !== undefined) fromJson(value, out);
    }
  }
}
