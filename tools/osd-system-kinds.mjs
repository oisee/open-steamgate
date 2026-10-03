// Where each SYSTEM kind runs under ADT on one runtime (docs/adt-abap-port/
// one-runtime-b2.md): a destination runs where its resource lives. Kept free
// of node: imports so the browser preview bundle can read it through
// osd-store-destination.mjs without pulling in the IPC client.
// Source facts also work in the inline runtime with the switch off.
export const SOURCE_SYSTEM_KINDS = new Set(["XREF_WARM", "OBJECT_TYPES", "TESTCLASSES", "SERVICE_ROWS", "SEGW_REGISTRATIONS"]);
export const PARENT_SYSTEM_KINDS = new Set(["BUILD", "CHANGED", "GIT", "SERVING", "SUPERVISOR", "WARM", ...SOURCE_SYSTEM_KINDS]);
export const CHILD_SYSTEM_KINDS = new Set(["SQL", "SQLCHECK", "CLASSRUN", "DUMP", "XREF", "SERVICES", "TRANSACTIONS"]);
