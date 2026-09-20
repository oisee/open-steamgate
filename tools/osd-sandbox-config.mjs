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

// **On GitHub Pages this one cannot be answered, and the reason is
// structural rather than an oversight.** The sandbox bootstrap asks for the
// path above from the ORIGIN root. The preview is served under
// /open-steamgate/main/ and its service worker's scope is that directory, so
// a request for oisee.github.io/appconfig/... never reaches the worker: it
// is outside the scope, which is a property of service workers and not
// something a route can fix. The two express hosts serve it; the published
// preview answers 404 and will keep doing so.
//
// Bounded, and measured: the config is optional and merged over the inline
// `window["sap-ushell-config"]` in webapp/flp.html, which carries the whole
// configuration. Clicking a tile in the preview works with the 404 present
// -- what broke tiles on 2026-09-20 was a component URL, not this. So the
// cost is one red line in a stranger's network tab, which is what E.5 set
// out to remove and removes everywhere the scope allows.
//
// Not guessed at further: there may be a sandbox parameter that moves the
// path, and naming one without reading UI5's bootstrap would be a fix
// believed rather than checked.

/** An empty merge. Not a placeholder: the configuration is inline in
 *  `flp.html`, and this file exists only so that asking for it succeeds. */
export const SANDBOX_CONFIG_BODY = "{}\n";

/** Give an express app the route. */
export function serveSandboxConfig(app) {
  app.get(SANDBOX_CONFIG_PATH, (req, res) => {
    res.type("application/json").send(SANDBOX_CONFIG_BODY);
  });
}
