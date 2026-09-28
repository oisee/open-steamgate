# VS Code for the Web gateway and webview transport probe

The development and test-web `browser` entry of `editors/vscode/package.json` runs a separate extension in the VS Code web extension host. `npm run vsix:marketplace` removes that entry from its staged package until the web extension is ready for Marketplace distribution. It bundles the prebuilt ABAP gateway and sql.js into one web worker script. The desktop `main` entry remains `extension.js`.

On activation, the web entry imports the preview backend, restores its sql.js database from IndexedDB, starts the gateway, and requests `$metadata`. It does not open an HTTP listener. `osd: Web probe` calls `handleRequest` in that worker: another `$metadata` GET (200), CSRF fetch, a uniquely named `TravelSet` POST (201), and a GET of the created row (200). **OSD Web Probe** output reports both activation start to the activation request's `$metadata` response and probe command start to its own `$metadata` response. `osd: Web verify last Travel` reads that row after a reload.

`osd: Web probe view` opens a webview with a virtual `https://osd.invalid` origin. Its `window.osdBridge.fetch(input, init)` accepts fetch-style URLs and request bodies; `window.osdBridge.installXHR(factory)` is the hook for a later UI5 XHR adapter. The postMessage request carries method, path, query, header pairs, and base64-encoded body bytes. The response carries status, status text, header pairs, and base64-encoded body bytes. The extension accepts only `/sap/opu/odata/` and `/sap/bc/` paths, adds the virtual host and forwarded protocol headers, and returns HTTP-shaped error responses instead of throwing through the message channel. The gateway queue exports every mutation to IndexedDB before its response is sent back to the webview.

The OSD Activity Bar view has a browser data provider. Its System group shows the in-browser gateway, the serving generation reported by `ZOSD_STATUS_SRV/SystemSet`, and sql.js with IndexedDB persistence. Services come from `ZOSD_STATUS_SRV/ServiceSet` through the same in-worker gateway and are grouped as OData, Apps, ICF, and APC. A single click on a service opens a minimal panel with its name, kind, and URL. The browser entry sets `osd.web`; manifest `when` clauses hide desktop launcher, source, test, and notebook actions while keeping the desktop entry’s menus intact.

Every modifying request exports the sql.js database to IndexedDB before the command returns. The stored database is keyed by the preview build ID so a new transpiled generation starts with its own seed. The last probe ID is also stored for the reload check.

## Worker data reads (S2d1)

The worker's `handleRequest` now answers `POST /osd/sql` with the same JSON fields as the desktop SQL door: `sql`, `columns`, `rows`, `count`, and `truncated`. JSON rows retain numbers and nulls. It also answers the desktop client routes `POST /sap/bc/adt/datapreview/freestyle`, `/ddic?ddicEntityName=...`, and `/cds?ddlSourceName=...` with the column-oriented XML consumed by the existing notebook and F8 parsers. DDIC and CDS names must exist as a table or view in the bundled database. The `rowNumber` query parameter sets the requested limit; the default is 100 and the worker ceiling is 1,000. `UP TO n ROWS` is rewritten, and the SQL is bounded before execution even when it already has a limit. Invalid SQL returns HTTP 400 with an error code and message (JSON on `/osd/sql`, XML on ADT routes). The ADT XML format represents cell values as text, as it does on desktop; the JSON door preserves types.

`osd: Web read probe` runs a five-row Open SQL SELECT, a DDIC preview, a capped read, and an invalid statement through the live worker. `npm run web:vscode:test` invokes it in Chromium alongside the existing OData and persistence checks. Editor F8 and notebook UI wiring is the next wave.

## Build and test locally

The repository's pinned ABAP libraries must be present in `.local/lars/` (`npm run bootstrap` fetches them into this checkout if needed). Then run:

```sh
npm run web:vscode:test
```

`web:vscode:test` first runs `web:vscode`, so it always tests a fresh bundle. `web:vscode` transpiles the gateway, generates the preview's seed and service tables without building its service worker, and bundles `editors/vscode/dist/web/extension.js` with the preview webpack aliases and polyfills. It prints raw and gzip byte counts. The headless test uses `npx -y @vscode/test-web` and the repository's Playwright Chromium; it uses a temporary VS Code download and browser profile, removes them afterward, and installs nothing into this clone's symlinked `node_modules`. It invokes the probe in VS Code's command palette, checks 200/201/200 and the returned row, reloads the same Chromium page, checks the row again, and checks the webview bridge. It prints both `$metadata` timings.

The default web profile is **core+zork**, matching the default `.vsix` pack selection. Set `OSD_WEB_PACKS=` for **core** (no packs), `OSD_WEB_PACKS=zork` for **core+zork**, or `OSD_WEB_PACKS=all` for the previous build with every discovered pack. A comma separated list selects other in-tree packs. `OSD_VSIX_PACKS` is used when `OSD_WEB_PACKS` is unset, so the two builds can share one selection. Selection applies to transpilation, seed rows, services, and the bundle; an unknown pack or a selected pack with missing fetched assets fails the build.

`web:vscode:test` first checks request bytes, path segments, and fetch-style content-type defaults in a test-only message-channel harness. It then runs `web:vscode`, so the browser exercises a fresh bundle. `web:vscode` transpiles the gateway, generates the preview's seed and service tables without building its service worker, and bundles `editors/vscode/dist/web/extension.js` with the preview webpack aliases and polyfills. It prints the bundle's bytes and MiB. The headless test uses `npx -y @vscode/test-web` and the repository's Playwright Chromium; it uses a temporary VS Code download and browser profile, removes them afterward, and installs nothing into this clone's symlinked `node_modules`. It invokes the worker probe, reloads and checks its row, then runs the webview's own metadata, CSRF, POST, GET, and `$batch` flow. The valid batch contains a GET and a changeset POST; the test reads the created row. It also fetches the demo PhotoSet image through the webview bridge and compares its SHA-256, byte length, content type, and content length with the gateway's direct answer. It reloads again and reads the webview-created row through the webview bridge. It prints both `$metadata` timings.

For a manual session, run `npm run web:vscode`, then `npx -y @vscode/test-web --browser chromium --extensionDevelopmentPath ./editors/vscode` and use the three commands above. Keep an npm cache in a writable temporary directory if your normal npm cache is read-only.

For a manual session, run `npm run web:vscode`, then `npx -y @vscode/test-web --browser chromium --extensionDevelopmentPath ./editors/vscode` and use the four commands above. Keep an npm cache in a writable temporary directory if your normal npm cache is read-only.

## Try in vscode.dev

Serve `editors/vscode/` itself (the directory with `package.json`) over trusted HTTPS with CORS enabled. For example, create and trust a local certificate with `mkcert`, then run an HTTPS static server such as `npx serve --cors -l 5000 --ssl-cert <cert.pem> --ssl-key <key.pem>` from that directory. In `https://vscode.dev`, run **Developer: Install Extension From Location...** and enter the server's `https://localhost:5000` URL. The browser must trust the certificate and be able to fetch `dist/web/extension.js` across origins. These steps follow the [VS Code web extension guide](https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-vscodedev). Run **osd: Web probe view**, click **Run write and batch probe**, and check that the result shows metadata 200, CSRF 200 with a token, POST 201 with a Location, GET 200, filtered GET 200, forbidden path 403, batch 202, and batch-row GET 200. Reload vscode.dev, open the view again, click **Verify saved row**, and check GET 200 with the same ID and description. This is the manual vscode.dev gate; the automated `@vscode/test-web` run uses the same webview flow.

## Scope and limits

The service panel currently shows only name, kind, and URL; it does not offer source links or entity sets. This first S2c wave does not yet install an XHR implementation, load the full Fiori app, or bridge WebSocket/APC. The desktop extension's Test Explorer, launcher, notebooks, and other Node-backed commands are not implemented in the web entry. Stored databases are not migrated between gateway build IDs. Packaging a published web VSIX and tests in browsers other than Chromium are outside this probe.

## Measured here

The pinned libraries and fetched pack assets were bootstrapped into this checkout. Each row is a fresh production bundle and a headless Chromium run of `web:vscode:test` on 2026-09-27. Gzip is measured over the emitted `extension.js` with Node's default gzip settings. Times are activation start to the activation request's first `$metadata` response. These are local measurements, not a download or startup target.

| Profile | Packs | Raw bytes | Gzip bytes | Activation to first `$metadata` | Probe and reload |
| --- | --- | ---: | ---: | ---: | --- |
| Today's all-pack build (`OSD_WEB_PACKS=all`) | All six checkout packs | 44,856,537 | 4,662,639 | 3,340 ms | 200/201/200; reload GET 200, same row; webview 200 |
| Core (`OSD_WEB_PACKS=`) | None | 34,255,462 | 3,357,844 | 3,053 ms | 200/201/200; reload GET 200, same row; webview 200 |
| Core+Zork (default) | Zork | 34,596,002 | 3,402,266 | 2,989 ms | 200/201/200; reload GET 200, same row; webview 200 |

The P1 Chromium baseline was a **44,852,884 byte (42.78 MiB)** bundle, 3,358 ms from activation to `$metadata`, and 7 ms from probe command to `$metadata`. The final S2c0 Chromium run built a **44,863,731 byte (42.79 MiB)** bundle and measured 3,344 ms and 7 ms, respectively. Its worker probe returned `$metadata` 200, POST 201, GET 200 with the row surviving reload. The webview returned metadata 200, CSRF 200, POST 201, filtered GET 200, forbidden path 403, batch 202, and the same webview-created row after reload. These are local measurements, not a download or startup target.
