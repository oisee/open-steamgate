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
