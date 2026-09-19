// The one file the Fiori launchpad sandbox asks for and we do not have.
//
// `webapp/flp.html` gives the whole configuration inline, in
// `window["sap-ushell-config"]`. The sandbox bootstrap **additionally**
// fetches an optional external config from an absolute path and merges it
// over that. We have nothing to add, so the honest answer is an empty merge
// — and a 404 in a stranger's network tab is not it (backlog E.5).
//
// It lives here rather than three times over because the path is absolute:
// it is served by the two express hosts as a route and written into the
// preview build as a file, and a rule about **what every host must do** goes
// in a module they all import (docs/luw-buffer.md said so about the dialog
// step; the same reason applies to a file every host must be able to answer).
export const SANDBOX_CONFIG_PATH = "/appconfig/fioriSandboxConfig.json";

/** An empty merge. Not a placeholder: the configuration is inline in
 *  `flp.html`, and this file exists only so that asking for it succeeds. */
export const SANDBOX_CONFIG_BODY = "{}\n";

/** Give an express app the route. */
export function serveSandboxConfig(app) {
  app.get(SANDBOX_CONFIG_PATH, (req, res) => {
    res.type("application/json").send(SANDBOX_CONFIG_BODY);
  });
}
