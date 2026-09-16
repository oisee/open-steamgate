# Preview deployments: the gateway in the browser

`npm run web:preview` builds a copy of open-steamgate that needs no server:
the transpiled ABAP gateway (dispatcher, DPC, MPC, SADL) and SQLite compiled
to JavaScript (sql.js) are bundled into a **service worker**. Any static host
serves `build/preview/`; the worker answers every request below
`<mount>/sap/opu/odata/sap/` itself, the Fiori Elements demo app under
`<mount>/app/` talks to it as if it were a Gateway system. The recipe is
[larshp/hithub](https://github.com/larshp/hithub)'s `docs/preview-deployments.md`
(MIT), adapted: no SMIM assets, the app is plain files, SAPUI5 comes from the
CDN and the worker leaves everything but the service path to the network.

| Where | What |
| --- | --- |
| `https://oisee.github.io/open-steamgate/main/app/` | the default branch (`app/flp.html` for the launchpad with both apps) |
| `https://oisee.github.io/open-steamgate/pr-<n>/app/` | every pull request, removed when it closes |
| `.../screenshots/` next to either | what the deployment looks like |

`.github/workflows/preview.yml` builds, checks the build in headless Chromium
(`playwright.preview.config.mjs`), takes the screenshots and publishes into the
`gh-pages` branch (`peaceiris/actions-gh-pages`, one directory per deployment).

## Packs on the preview

The demo (`/sap/bc/zo4d_demo/`) and Zork (`/sap/bc/zork/`) are packs, not
content of this repository: `packs/o4d/osd-pack.json` and
`packs/zork/osd-pack.json` name their repositories and a commit, and the
workflow runs `node tools/osd-fetch.mjs` before the build, which copies each
one into `packs/<name>/upstream/` and lets the pack's own `src/` layer over
it (the Zork overlay is the APC handler, the ICF node, the story file and
four classes changed for the transpiler). `scripts/build-preview.mjs` then
takes the packs' ICF nodes and channels into `services.mjs`, their SMW0
objects into `media/`, their pages into `app/<name>/` and their tiles into
`app/packs.json`, and refuses to build when a declared source is not there.
The launchpad's URL tiles are relative (`../sap/bc/zork`), so they work
under `/open-steamgate/main/` as they do on port 3030.

## Pieces

- `web/preview-worker.mjs` — the service worker. Scope is the mount directory;
  it intercepts `sap/opu/odata/sap/**` and `__preview/reset`, nothing else.
  The database is exported into cache storage after every write and read back
  when the worker restarts; a different build id (`init.mjs` + seed hash)
  starts over.
- `web/preview-backend.mjs` — what `test/start.mjs` is for express: boots the
  runtime, registers the demo services, forwards a request through
  `cl_express_icf_shim` into `zcl_stg_http_handler`. Requests are serialized:
  the shim keeps one static server object.
- `web/preview-runtime.mjs` — `window` alias for the runtime's `window.crypto`,
  `Date` pinned so two builds of the same code render the same pixels.
- `test/setup.mjs` — when `globalThis.__stgPreview` exists it opens sql.js on
  the stored bytes (or schema + inserts + seed from the bundle) instead of
  reading `data/` from disk.
- `scripts/build-preview.mjs` — generates `web/generated/seed.mjs`, runs
  webpack (`webpack.config.cjs`: `webworker` target, Node polyfills, `%23`
  namespace filenames mapped back to `#`, DuckDB kept out), copies `webapp/`
  to `build/preview/app/` with a loader that registers the worker before UI5 boots
  (in `index.html` and in `flp.html`, the launchpad page).
- Absolute URLs (`__metadata.uri`, `Location`) need the outside view: the
  worker sends `x-forwarded-proto` / `x-forwarded-prefix`, `zcl_stg_http_handler`
  turns them into the origin the dispatcher prints.

## Locally

```sh
npm run web:preview          # transpile + bundle into build/preview/
npm run web:serve            # http://localhost:3031/  (static, like Pages)
npm run e2e:preview          # build + the Playwright check on it
node scripts/capture-screenshots.mjs
```

The check uses a persistent Chromium profile: Playwright's ephemeral context
refuses service worker storage on some setups ("Failed to access storage").

## What it is not

- Not shared: the database lives in the visitor's browser; a reset is
  `<mount>/__preview/reset`.
- Not DuckDB: the preview is always sql.js. DuckDB stays a Node-side store.
- Not a second runtime: the same `output/` the tests and `npm start` use.
