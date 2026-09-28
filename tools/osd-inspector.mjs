// The V8 inspector of a serving child, opened and closed while it runs.
//
// A debugger used to need the system started with one (`osd.debug`, then
// OSD_INSPECT=<port> on the child's NODE_OPTIONS): without it, "Run with
// debugger" and a breakpoint had nothing to attach to until a restart.
// Node opens its inspector at runtime (`node:inspector` open/close), so the
// supervisor asks over the process channel instead
// ({type: "inspector", id, open, port}) and the child answers
// {type: "inspector-done", id, ok, open, url, port | error}.
//
// Loopback only, always: the inspector is code execution for whoever
// connects, and a host other than 127.0.0.1 is refused here rather than
// trusted to the caller. Opening on a port it already listens on is a
// no-op; opening on another port moves it.

export const INSPECTOR_HOST = "127.0.0.1";

/** OSD_INSPECT as a port: "1" or "true" is Node's default 9229 (the escape
 *  hatch for a shell: `OSD_INSPECT=1 npm start`), a number is that port,
 *  anything else is off. */
export function inspectPortOf(value) {
  if (value === undefined || value === "" || value === "0" || value === "false") return undefined;
  if (value === "1" || value === "true") return 9229;
  const port = Number(value);
  return Number.isInteger(port) && port > 1 && port <= 65535 ? port : undefined;
}

function portOfUrl(url) {
  if (typeof url !== "string") return undefined;
  const match = /^ws:\/\/[^/]*:(\d+)\//.exec(url);
  return match === null ? undefined : Number(match[1]);
}

/** Applies one request to `inspector` (node:inspector's shape: open, close,
 *  url) and returns the answer to send back. */
export function inspectorRequest(message, inspector) {
  const id = message?.id;
  try {
    if (inspector === undefined || typeof inspector.open !== "function") {
      throw new Error("this host has no V8 inspector to open");
    }
    if (message.open !== true) {
      if (inspector.url() !== undefined) inspector.close();
      return {type: "inspector-done", id, ok: true, open: false};
    }
    const port = Number(message.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid inspector port: ${message.port}`);
    }
    if (message.host !== undefined && message.host !== INSPECTOR_HOST) {
      throw new Error(`the inspector listens on ${INSPECTOR_HOST} only, not ${message.host}`);
    }
    const current = inspector.url();
    if (current !== undefined && portOfUrl(current) !== port) inspector.close();
    if (inspector.url() === undefined) inspector.open(port, INSPECTOR_HOST, false);
    // stack traces of a debugged child name .abap lines too
    process.setSourceMapsEnabled?.(true);
    const url = inspector.url();
    return {type: "inspector-done", id, ok: true, open: true, url, port: portOfUrl(url) ?? port};
  } catch (error) {
    return {type: "inspector-done", id, ok: false, error: String(error?.message ?? error)};
  }
}
