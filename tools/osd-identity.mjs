// Who this system says it is, in one place.
//
// There were four answers to "which system is this?", and they disagreed
// (backlog G.1b):
//
//   - the ABAP runtime's own constants: sy-sysid ABC, sy-mandt 123,
//     sy-uname USERNAME (@abaplint/runtime, builtin/sy.ts), never set by us;
//   - the status table ZOSD_SYS-SID, which was STG_ADT_SID or "OSG"
//     (tools/osd-status.mjs);
//   - the ADT façade, which tells Eclipse it is OS2, client 001, user
//     DEVELOPER (tools/adt-facade.mjs);
//   - and the Easy Access screen, whose status bar printed a session number
//     and a client nobody had ever set.
//
// This module is the one source. The boot sets sy from it (test/setup.mjs,
// for the browser web/preview-backend.mjs), the status snapshot names the
// same sid, the façade takes its identity from here, and the screen reads sy
// — so the bar cannot say something the rest of the system does not.
//
// Two names, and the reason they differ.
//
// The runtime-facing id (OSD_SID) is what the ABAP in this system sees as
// sy-sysid and what the status service reports. The ADT-facing id
// (STG_ADT_SID) is what Eclipse sees, and it is a different thing: an ABAP
// project stores the id it was created against and refuses a logon to a
// system reporting another one ("Logon was not performed to the service
// instance of the project OS2, but to service instance: OSD"), so renaming it
// locks the owner of a working project out — which is exactly what happened,
// twice, and why the default is a constant and not derived from anything.
// The same holds for the ADT client: 001 is part of what a project was
// created against and of the session cookie's name (SAP_SESSIONID_OS2_001),
// while the runtime client is 123 because that is the client the seed rows in
// data/ are in. So: one module, two names, defaults that are deliberately not
// the same, and nothing invented anywhere.
//
// STG_ADT_SID still renames both, as it always did (scripts/check-hosts.mjs,
// test/osd-binary.mjs set it), so nothing that used it changes meaning.

const DEFAULT_SID = "OSG";
const DEFAULT_CLIENT = "123";
const DEFAULT_USER = "DEVELOPER";
const DEFAULT_ADT_SID = "OS2";
const DEFAULT_ADT_CLIENT = "001";

// a system id is three characters, upper case, on a real system and here
function sidOf(value, fallback) {
  const text = String(value ?? "").trim().toUpperCase();
  return text === "" ? fallback : text.slice(0, 3);
}

function clientOf(value, fallback) {
  const text = String(value ?? "").trim();
  return text === "" ? fallback : text.slice(0, 3);
}

/**
 * What this system is, from the environment (or any object shaped like one,
 * which is how the browser build passes the build-time id in).
 */
export function identity(env = globalThis.process?.env ?? {}) {
  const sid = sidOf(env.OSD_SID ?? env.STG_ADT_SID, DEFAULT_SID);
  const client = clientOf(env.OSD_CLIENT, DEFAULT_CLIENT);
  const user = String(env.OSD_USER ?? DEFAULT_USER).trim().toUpperCase().slice(0, 12);
  return {
    sid,
    client,
    user,
    language: "E",
    // what Eclipse sees, and why it is allowed to differ: see above
    adt: {
      systemID: sidOf(env.STG_ADT_SID, DEFAULT_ADT_SID),
      client: clientOf(env.OSD_ADT_CLIENT, DEFAULT_ADT_CLIENT),
      userName: user,
      userFullName: String(env.OSD_USER_FULL ?? "Off-Stack Doppelganger"),
      language: "EN",
    },
  };
}

/**
 * The boot: the transpiled runtime's sy is set from the identity, so ABAP
 * asking sy-sysid / sy-mandt / sy-uname gets this system's answer rather than
 * the runtime's three placeholders. Called from test/setup.mjs, which is the
 * setup hook every host of this tree boots the ABAP through — node, the
 * binary, and the service worker.
 */
export function bootIdentity(abap, env) {
  const who = identity(env);
  const sy = abap?.builtin?.sy?.get?.();
  if (sy === undefined) {
    return who;
  }
  sy.sysid?.set(who.sid);
  sy.mandt?.set(who.client);
  sy.uname?.set(who.user);
  return who;
}
