# VS Code for the Web gateway probe (P1)

The `browser` entry of `editors/vscode/package.json` runs a separate extension in the VS Code web extension host. It bundles the prebuilt ABAP gateway and sql.js into one web worker script. The desktop `main` entry remains `extension.js`.

On activation, the web entry imports the preview backend, restores its sql.js database from IndexedDB, starts the gateway, and requests `$metadata`. It does not open an HTTP listener. `osd: Web probe` calls `handleRequest` in that worker: another `$metadata` GET (200), CSRF fetch, a uniquely named `TravelSet` POST (201), and a GET of the created row (200). **OSD Web Probe** output reports both activation start to the activation request's `$metadata` response and probe command start to its own `$metadata` response. `osd: Web verify last Travel` reads that row after a reload. `osd: Web probe view` opens a small webview that asks the extension for `$metadata` through `postMessage`; only that path is accepted by the bridge.

Every modifying request exports the sql.js database to IndexedDB before the command returns. The stored database is keyed by the preview build ID so a new transpiled generation starts with its own seed. The last probe ID is also stored for the reload check.

## Build and test locally

The repository's pinned ABAP libraries must be present in `.local/lars/` (`npm run bootstrap` fetches them into this checkout if needed). Then run:

```sh
npm run web:vscode:test
```

`web:vscode:test` first runs `web:vscode`, so it always tests a fresh bundle. `web:vscode` transpiles the gateway, generates the preview's seed and service tables without building its service worker, and bundles `editors/vscode/dist/web/extension.js` with the preview webpack aliases and polyfills. It prints the bundle's bytes and MiB. The headless test uses `npx -y @vscode/test-web` and the repository's Playwright Chromium; it uses a temporary VS Code download and browser profile, removes them afterward, and installs nothing into this clone's symlinked `node_modules`. It invokes the probe in VS Code's command palette, checks 200/201/200 and the returned row, reloads the same Chromium page, checks the row again, and checks the webview bridge. It prints both `$metadata` timings.

For a manual session, run `npm run web:vscode`, then `npx -y @vscode/test-web --browser chromium --extensionDevelopmentPath ./editors/vscode` and use the three commands above. Keep an npm cache in a writable temporary directory if your normal npm cache is read-only.

## Try in vscode.dev

Serve `editors/vscode/` itself (the directory with `package.json`) over trusted HTTPS with CORS enabled. For example, create and trust a local certificate with `mkcert`, then run an HTTPS static server such as `npx serve --cors -l 5000 --ssl-cert <cert.pem> --ssl-key <key.pem>` from that directory. In `https://vscode.dev`, run **Developer: Install Extension From Location...** and enter the server's `https://localhost:5000` URL. The browser must trust the certificate and be able to fetch `dist/web/extension.js` across origins. These steps follow the [VS Code web extension guide](https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension-in-vscodedev).

## Scope and limits

P1 proves one in-worker OData route, one webview fetch bridge, and IndexedDB persistence. It does not expose a general browser `fetch` endpoint, a localhost listener, WebSocket/APC bridging, or the preview's full Fiori app. The desktop extension's Test Explorer, launcher, notebooks, and other Node-backed commands are not implemented in the web entry. Stored databases are not migrated between gateway build IDs. The webview returns only the first 1,000 characters of metadata for display. Packaging a published web VSIX and tests in browsers other than Chromium are outside this probe.

## Measured here

The pinned libraries were bootstrapped into this checkout before the build. The production webworker bundle is **44,852,884 bytes (42.78 MiB)**. In the final Chromium run, activation start to the activation request's `$metadata` response was **3,358 ms**; command start to the probe request's `$metadata` response was **7 ms**. The probe returned `$metadata` 200, POST 201, GET 200; after a page reload, GET returned the same row with 200. The webview bridge displayed `$metadata` with 200. These are local measurements, not a download or startup target.
