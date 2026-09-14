# Does any of this run on Bun? Measured, 2026-09-13

The Bun packaging idea rested on an assumption nobody had tested: that the
transpiled runtime and this gateway run on Bun at all. Thirty minutes, and
the answer is yes, with one defect found and worked around.

Bun 1.4.2, installed for the user (`~/.bun`), against the same tree Node
runs. Nothing in the repository was changed for it.

## The one defect: `%23` in a module specifier

The transpiler names a `/IWBEP/`-namespaced object's file with hashes,
`#iwbep#cl_mgw_data_util.clas.mjs`, and imports it with the hash
percent-encoded, because a bare `#` in an ESM specifier would start a
fragment:

```js
const {x} = await import("./%23iwbep%23cl_mgw_data_util.clas.mjs");
```

Node decodes that and finds the file. **Bun does not**, and the run dies at
the first such import. It is symmetric, which is what makes it a divergence
rather than a missing feature:

| specifier | Node 26 | Bun 1.4.2 |
| --- | --- | --- |
| `"./%23hash%23mod.mjs"` | resolves | `Cannot find module` |
| `"./#hash#mod.mjs"` | `Cannot find module` | resolves |

Ninety-nine files in `output/` carry a hash today.

**The workaround is twenty lines** and was enough for this spike: copy the
transpiled output, rename `#` to something plain in the file names, and
rewrite the same substitution inside relative `./…mjs` specifiers only.
Twenty-two files needed a rewrite. After that everything below worked.

**The real fix is filed**: `abaplint/transpiler#1841`, opened by the
transpiler session on the day of this spike, with these measurements as its
evidence. It traces to two lines that write `/` as `%23`, in
`escapeNamespaceFilename` and in the source-map line of the CLI. It is an
issue and not a patch on purpose: changing the character changes everything
that maps a file back to an object name, so the choice belongs to the
maintainer, and `$`, `-` and `_` all avoid encoding everywhere. The other
half, a Bun issue for the specifier decoding, is not filed. Logged in
`ANORMALIES.md`.

## What ran

With the rename applied to a copy:

- **ABAP Unit: 107 tests, the same list Node runs, exit 0.** Not a subset,
  not a skip: the same names in the same order.
- **The gateway over HTTP**, started under Bun on the express shim:
  `$metadata` with its twelve entity types, entity-set reads, a media
  resource (`PhotoSet('T0001')/$value` answered 930 bytes of `image/png`),
  virtual elements computed by the ABAP exit class, a published CDS service
  (`ZC_STG_TRAVEL_CDS`), and a write (`POST` answered 201).

So the runtime, the database layer, the OData gateway, SADL, the CDS
machinery and the media path all work on JavaScriptCore without a single
shim. That is more than the goja path managed even after lowering.

## Speed, such as it is

| | Bun 1.4.2 | Node 26 |
| --- | --- | --- |
| twenty entity-set reads | 220 ms | 264 ms |
| the whole ABAP Unit suite | 3.06 s | 1.91 s |

Per request Bun is a little quicker, about eleven milliseconds against
thirteen. The unit suite is the other way round, and the likely reason is
startup plus the wasm build of sql.js doing the heavy database work; a
native `bun:sqlite` backend is exactly what would move that number, and it
is the first item of the packaging work.

Neither figure is a benchmark. They are two runs on one laptop, quoted so
nobody plans around a guess.

## What this does and does not settle

It settles feasibility: no lowering, no shims, no missing engine features,
which is the thing that killed the goja path until Babel was added. It does
not settle `bun build --compile`, which is the next question and a separate
one: a compiled binary has to carry the same files, and the `%23` defect
lands there too.

---

# Part two: the bundler and the binary. Measured 2026-09-14

Part one settled that Bun *runs* the thing. Two questions were left open:
whether Bun could also replace webpack, and whether `bun build --compile`
inherits the `%23` defect. Both are now measured, and one of the answers
reverses what part one predicted.

## Three corrections to what was believed

**There are no native dependencies.** `@abaplint/database-sqlite` depends on
`sql.js`, which is wasm. The only native module in the tree is the optional
DuckDB driver. The "will native modules block a binary" question, carried
since the idea was raised, does not exist.

**The percent defects are a bundler footnote, not a blocker.** Both
`%23` (namespaces) and `%25` (W3MI names, 172 files today) close with one
`Bun.build` plugin whose `onResolve` decodes the specifier — the same shape
as webpack's `NormalModuleReplacementPlugin`, ten lines for both. What
`ANOMALY-2026-09-13-bun-percent-encoded-specifier` blocks is the
*interpreted* path, `bun entry.mjs`.

**`bun build --compile` does not inherit it.** Measured directly rather than
reasoned about, with one file importing `./%23iwbep%23mod.mjs`:

| | result |
| --- | --- |
| `bun entry.mjs` | `Cannot find module "./%23iwbep%23mod.mjs"` |
| `bun build --compile entry.mjs` | `Could not resolve` — the CLI takes no plugin |
| `Bun.build({compile, plugins})` | binary built, **runs, prints the value** |

So transpiler #1841 is no longer a gate for packaging. It stays worth having
— it would remove the plugin and fix the interpreted path — but backlog 1.3
should not wait on Lars for it.

## Bun as the bundler: 166 times faster, and it does not work

`bun build web/preview-worker.mjs --target=browser` against the same graph
webpack bundles:

| | Bun 1.4.2 | webpack 5.110.3 |
| --- | --- | --- |
| time | **337 ms** | 56 000 ms |
| size | 33.3 MB unminified | 22.8 MB minified |

The walls, in the order they appeared, because the order is the useful part:

1. `/* webpackIgnore: true */` in `tools/rfc-live.mjs:102`. A hint only
   webpack understands, telling it not to follow the live-RFC import into
   Node-only code. Bun followed it and drowned in `node:net`, `node:os`.
   Bun's equivalent is `external: ["open-rfc"]`. Worth knowing that our
   source carries instructions addressed to one particular bundler.
2. DuckDB, `%23` and `%25` — plugins, about ten lines, one-to-one with what
   `webpack.config.cjs` already does.
3. The wall: **`Cannot use 'import.meta' outside a module`**, plus 8893
   top-level awaits. Logged as
   `ANOMALY-2026-09-14-bun-bundler-module-output`. It built; it would not
   evaluate; all four preview e2e tests went red.

Ten of webpack's jobs are load-bearing here and worth listing, because
"swap the bundler" reads cheap until they are counted: sixteen node-builtin
browser polyfills, `symlinks: false` for the linked clones, the sql.js
asm alias, the three specifier rewrites, the DuckDB ignore, the
`Buffer`/`process` provides, one-chunk output, and Terser with
`keep_classnames`/`keep_fnames` — that last one not cosmetic, because the
runtime looks classes up by name.

**Conclusion: webpack stays for the preview.** The 166× is real and tempting
and does not matter while the output cannot be evaluated. Nothing about this
touches the binary, where a module target makes both constructs legal.

## The single-file HTML question, answered by the same fact

Asked while this was measured: can the whole thing be bundled into one local
HTML file, opened from disk with no server?

A service worker **cannot be registered from `file://`**. Not "works badly" —
cannot. So the current architecture, where interception is the worker's job,
has no single-file form.

But the worker is only the interception seam; the runtime is ordinary
JavaScript. Moving it into the page and shimming `fetch` and
`XMLHttpRequest` instead is the route, and the pattern already exists here:
`web/preview-socket.mjs` shims `WebSocket` and the worker injects it into
the page as a classic script. `handleRequest({method, path, search, headers,
body})` knows nothing about transport, so the shim is tens of lines rather
than a rewrite.

The costs are real: ~33 MB of JavaScript plus 11 MB of media as data URIs
(+33% for base64) is a 45–50 MB file, re-parsed on every open because there
is no worker cache; UI5 still comes from the CDN, and cannot be embedded
because Fiori Elements (`sap.fe`, `sap.ui.generic.app`) is SAPUI5 and not
OpenUI5. And `file://` refuses `<script type="module">`, so the build needs
a classic script with lowered top-level await — which is precisely the thing
webpack does and Bun does not. The two questions of the day meet at one
property.

Worth doing only for "send someone a file they double-click". Where an
executable may be run, the binary is better: it is the server, so the https
that a worker demands off localhost stops being a problem.
