// Who this system says it is, in one place.
//
// There were four answers to "which system is this?", and they disagreed
// (backlog G.1b):
//
//   - the ABAP runtime's own constants: sy-sysid ABC, sy-mandt 123,
//     sy-uname USERNAME (@abaplint/runtime, builtin/sy.ts), never set by us;
//   - the status table ZOSD_SYS-SID, which was STG_ADT_SID or "OSG"
//     (tools/osd-status.mjs);
//   - the ADT façade, which told Eclipse it was OS2, client 001, user
//     DEVELOPER (tools/adt-facade.mjs);
//   - and the Easy Access screen, whose status bar printed a session number
//     and a client nobody had ever set.
//
// This module is the one source. The boot sets sy from it (test/setup.mjs,
// for the browser web/preview-backend.mjs), the status snapshot names the
// same sid, the façade takes its identity from here, and the screen reads sy
// — so the bar cannot say something the rest of the system does not.
//
// One name, one setting.
//
// The system id is OSD_SID (STG_ADT_SID is an alias that means exactly the
// same; when both are set OSD_SID wins), and when neither is set it is "OSD",
// the product. Every surface reads it from here: sy-sysid (the boot below),
// ZOSD_SYS-SID and the status service (tools/osd-status.mjs), the ADT
// systeminformation's systemID and the feeds' contributor
// (tools/adt-facade.mjs, the ABAP front through SYSTEM IDENTITY), the ADT
// session cookie SAP_SESSIONID_<SID>_<client> (tools/adt-session.mjs), the
// Easy Success status bar (it prints sy), the DIAG/RFC bridges
// (tools/protocols/) and the preview (scripts/build-preview.mjs). OSGo
// applies the same rule (tools/gogen/go/abap/sysinfo.go, SIDFromEnv).
// `osd doctor` prints the id and whether the setting or the default chose it.
//
// History: the runtime used to say OSG and the ADT façade OS2, kept apart
// because an Eclipse project refuses a logon to a system reporting another
// id than the one it was created against. Nobody runs Eclipse against this
// system yet, so that lock-out is moot and the two names became one
// (2026-10-02). Rename a system before Eclipse projects exist, not after.
//
// The client stays split on purpose: sy-mandt is 123 because that is the
// client the seed rows in data/ are in, while ADT presents client 001
// (OSD_ADT_CLIENT), which is also the client in the session cookie's name.

const DEFAULT_SID = "OSD";
const DEFAULT_CLIENT = "123";
const DEFAULT_USER = "DEVELOPER";
const DEFAULT_ADT_CLIENT = "001";

// the setting, its alias, in the order they are asked; an empty or blank
// value counts as unset, so it falls through to the next one
const SID_SETTINGS = ["OSD_SID", "STG_ADT_SID"];

// a system id is three characters, upper case, on a real system and here
function sidOf(value) {
  return String(value ?? "").trim().toUpperCase().slice(0, 3);
}

function clientOf(value, fallback) {
  const text = String(value ?? "").trim();
  return text === "" ? fallback : text.slice(0, 3);
}

/**
 * The system id and where it came from: {sid, source}, source being the
 * name of the setting that gave it ("OSD_SID" or "STG_ADT_SID") or
 * "default".
 */
export function systemId(env = globalThis.process?.env ?? {}) {
  for (const name of SID_SETTINGS) {
    const sid = sidOf(env[name]);
    if (sid !== "") {
      return {sid, source: name};
    }
  }
  return {sid: DEFAULT_SID, source: "default"};
}

/** The name of the ADT session cookie: SAP_SESSIONID_<SID>_<client>. */
export function sessionCookieName(env = globalThis.process?.env ?? {}) {
  const who = identity(env);
  return `SAP_SESSIONID_${who.adt.systemID}_${who.adt.client}`;
}

/**
 * What this system is, from the environment (or any object shaped like one,
 * which is how the browser build passes the build-time id in).
 */
export function identity(env = globalThis.process?.env ?? {}) {
  const {sid, source} = systemId(env);
  const client = clientOf(env.OSD_CLIENT, DEFAULT_CLIENT);
  const user = String(env.OSD_USER ?? DEFAULT_USER).trim().toUpperCase().slice(0, 12);
  return {
    sid,
    sidSource: source,
    client,
    user,
    language: "E",
    // what Eclipse sees: the same id, and the ADT client (see above)
    adt: {
      systemID: sid,
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
