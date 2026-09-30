
## Current execution plan — 2026-09-22

The next delivery sequence is documented in
[Preview release and OSD Doctor plan](preview-release-and-doctor.md):

1. publish `v0.1.0-preview.1` from one source revision on AMD64 and ARM64;
2. build the system-scoped OSD Doctor runner, API and Fiori cockpit;
3. automate multi-arch promotion only after the manual preview path is proven.

Doctor owns system and infrastructure acceptance. Workbench continues to own
object-scoped ABAP Unit discovery, execution and navigation.

## A pre-flight for the ABAP we generate (2026-09-19, next)

Six findings in one evening had one shape: a file that describes **enough
for this runtime and not enough for a system**. abaplint passed every one of
them, because abaplint checks the language and these were facts about a
system -- a buffering flag with no type, a search help parameter with no
data element, a date in the internal format where abapGit wants ISO, a
generic table type used as a structure component. The only reader that could
tell us was A4H, and the loop was: build a zip, a person imports it, an
error comes back in a chat message.

**That loop can be two steps shorter.** ADT answers a syntax check for
source that is *not on the system*: `/sap/bc/adt/checkruns` with reporter
`abapCheckRun`, which the system's own `checkruns/reporters` lists as
supporting `CLAS*`, `INTF*`, `PROG*`, `TABL/DT`, `DTEL/DE` and the rest.
Measured tonight through the MCP: the wrong version of
`ZCL_ZOSD_004_DEMO_MPC_EXT` returns

    "TT_BOOKING" is a generic type. Use this type only for typing field
    symbols and formal parameters.

and the fixed one returns nothing at all -- **before** any import,
activation, or person.

So: `stg-compile` (and segw-gen) should be able to ask a system about what
they just wrote. Off by default and never in CI, because it needs a system
and credentials; on when a developer asks for it, the way `STG_DB=hana` is.
The connection belongs under `.local/` with everything else that names a
host.

Worth doing for one reason above the others: **abaplint and a system
disagree, and the disagreement is the interesting part.** Every one of
tonight's six was invisible here and obvious there, and each cost a round
trip through a human. A check that asks the system turns that into a build
message.

---

## The container, 2026-09-19: five fixed, two open, and both open ones named

Written down because the session that measured it will not be the one that
finishes it, and because four of the five were invisible until somebody ran
the thing rather than read it.

**Fixed.**
- `wget` and `libatomic1` are in the image. `debian:12-slim` had neither, so
  the health check -- a wget pipeline -- could never pass, **in either
  profile**. A container serving `$metadata` 200 the whole time reported
  `unhealthy` five probes running.
- The health check reads `system.serving` instead of grepping for the word
  `commit`, anchored on the `live` field before it because `database.serving`
  is a second field of that name one level down.
- **And then it asks for a row**, because the corrected check went green on a
  HANA container whose seed had died and whose every entity set was empty. A
  failed seed leaves a schema `hasSchema()` accepts, so the next boot skips
  seeding and serves nothing, healthily, at 200. Proven both ways: sqlite
  `exit=0` five times, hana `exit=1` five times.
- One check for two services, by YAML anchor. They were copies; correcting
  one left the other -- and the other was the service the false green had
  been measured on.
- `make-release` derives the runtime closure instead of listing it (the list
  shipped `temporal-polyfill` without `temporal-utils`/`temporal-spec`), and
  bundles `hdb` into **one CJS file**, because the package directory does not
  resolve in a compiled binary.

**Open, and named rather than felt.**
- **The HANA seed fails with `incorrect syntax near ","` at pos 223** and the
  statement is still unidentified. Reproducible on the host from
  `.local/release`, so not a container effect. Excluded by measurement: the
  generation's 2642 inserts (no multi-row VALUES), the 36 seed statements
  (none after rewrite), the 104 pg DDL statements, and `loadScaledData`
  (a no-op without `STG_DATA_SCALE`). The one statement matching the
  geometry was sent to HANA live and **accepted**. The live finding is that
  the error does **not** pass through `HanaDatabaseClient.#run`, whose
  explainer is proven to work against a real HANA -- so something outside
  the client is sending it. That is the next step.
- **`STG_SERVE=inline` ignores `STG_PORT`** in the compiled binary: it starts,
  serves, and announces a random port. Confirmed on two binaries a day apart,
  so not a regression, and `[proxied]` is absent, so the switch does work.
  Diagnosis through inline is therefore possible -- read the port from its
  output rather than setting it.

**One fact that explains three different-looking failures.** A compiled Bun
binary resolves `hdb` from the **cwd's** `node_modules`: from the repository
root it finds the real package and dies on `Cannot find package
'iconv-lite'`; from the release directory it finds the pre-bundled file and
works. Three faces, one cause, and they were called three defects for most
of a day.

---

## 1. The Bun binary (gated on 0.1)

```
1.1  bun:sqlite backend for the DatabaseClient seam                   [S]
     └─ eleven methods + the seven rewrites (docs/db-backends.md)
     └─ must keep the seed path alive: test/seed.mjs over data/*.tabu.json,
        T's SEGW tables ride on it
1.2  Bun.serve adapter, replacing express-icf-shim                    [S]
     └─ the ABAP side (zcl_stg_http_handler) does not change
1.3  build and stitch: bun build --compile, one exe per platform      [S]
     └─ external: CI runners per platform
     └─ NOT gated on #1841 any more, measured 2026-09-14: the bundler's
        onResolve closes %23 and %25 together, ten lines, and the compiled
        binary runs. #1841 stays worth having (it would delete the plugin
        and fix `bun <script>`) but nothing waits on Lars for it
     └─ known: mainstream platforms only, ~60-100 MB per exe
1.4  APC over Bun websockets                                          [T]
     └─ open-abap-apc as an outside library, cloned into .local/lars
     └─ not gated on Lars: the library ships its own copy of the SAP-named
        part today and works; the PR (9.4) only makes it prettier
1.5  layers: the binary takes an ordered list of abapGit src paths   [S+A]  (E.1 done 2026-09-16: the list is abap_transpile.json, later wins; the binary's argument is E.2)
     └─ Alice's formulation, 2026-09-14: later layers win on a name
        collision, and data layers (data/*.tabu.json) apply the same way
     └─ the argument is not theoretical: local/o4d/ and local/vivid-vibes/
        both carry ZCL_O4D_HTTP_HANDLER, and on 2026-09-14 whichever the
        directory walk reached first won, silently. Explicit order plus a
        report of what was overridden is the whole feature
     └─ the unifying bit: hash(ordered layers) is the transpile cache key
        AND the ADT version-id Alice proposed earlier. One number, three
        uses, and it is what makes "spin a runtime from sources" fast —
        first run transpiles 1065 objects, later runs do not
     └─ open, needs Alice: does a layer override the OBJECT (all its
        files) or single FILES? Overriding .clas.abap without .clas.xml
        is the case that decides it                                   [A]
     └─ zip as a layer: an abapGit export unpacked into the cache;
        current behavior, write policy and related decisions: docs/source-layers.md
1.6  the runtime half of packaging, in order                          [S]
     └─ measured first, built second: `bun tools/osd-serve.mjs`
        interpreted is the next cheap check, and it is where the %23
        defect still bites (1.3 is unaffected)
     └─ then the supervisor: ServingRuntime spawns a SCRIPT PATH today;
        a binary must spawn `process.execPath serve --port ...`, so the
        entry needs subcommands before --compile is useful
```

## 1a. Shipping shapes that are not the binary

Three exist or could: the browser bundle (done), the binary (section 1),
and one local HTML file. They answer different questions, and the third is
the only one still undecided.

```
1a.1 the browser bundle                                          [S] DONE
     └─ service worker + sql.js, every ICF service, APC channels, and
        since 2026-09-14 the SMW0 media. Read-only showroom: no ADT, no
        activation, no writes that outlive the tab
     └─ needs https off localhost, which is the friction the binary removes
1a.2 one local HTML file, opened from disk                        [S+A]
     └─ FACT, not an opinion: a service worker cannot be registered from
        file://. So this is not "bundle harder", it is a different seam —
        run the runtime IN THE PAGE and shim fetch + XMLHttpRequest
     └─ already half-built without meaning to: preview-socket.mjs shims
        WebSocket the same way, and handleRequest({method, path, search,
        headers, body}) knows nothing about transport. Tens of lines
     └─ cost: ~45-50 MB (33 MB JS + 11 MB media as base64), re-parsed on
        every open, UI5 still from the CDN
     └─ needs webpack, not Bun: file:// refuses <script type="module">,
        so the build must be a classic script with TLA lowered
     └─ worth it only for "send someone a file they double-click". Where
        an executable may be run, the binary wins                     [A]
1a.3 UI5 is NOT embedded in any of them — decided 2026-09-14         [S]
     └─ Fiori Elements (sap.fe, sap.ui.generic.app) is SAPUI5 and is not
        in OpenUI5, so embedding OpenUI5 buys freestyle apps and not the
        thing the project is for. Licence aside, it would not work
     └─ instead: CDN by default, `osd ui5 fetch` caching a dist under
        ~/.osd/ui5/<version>/ for offline, --ui5 <dir> to point at one
```

### `npm run unit` can say it ran nothing (2026-09-19)

**The provenance, honestly, because the report this came from was wrong.**
osg-osd-i7 reported eight tests that printed `OK` and never ran. They had
run all along: the first reading was `npm run unit 2>&1 | tail -15` over a
seventeen-line file, and the lines were in the middle of it. **A log
truncated by the command that produced it is indistinguishable from a log of
something that never happened** — `tail -15` and "it did not run" look the
same on a screen. (The same knife twice in one day: the morning's
`coverage.mjs` header went the same way through `tail -25`.)

So there was no green-without-a-run. The check stayed for two reasons that
do not depend on the report:

1. **its first run found a real one** — `ZCL_EDITOR`, a test class that
   genuinely never executes — and named why. That is the check's finding,
   not anybody's report.
2. `OK` meant "nothing failed" and never "something passed", and the two
   were printed with one word. "Nothing ran" is the third value of a test
   run's verdict, the way "not measured" is the third value everywhere else
   here, and a verdict that cannot print its third value eventually prints
   the nearest of the other two.

`tools/osd-unit-run.mjs` runs the transpiled suite and then compares what
the **tree** holds against what the **runtime reported**. A test class in
the tree that never appears is named and the run fails. Nothing here checks
whether a test passed — the runtime already does that, loudly.

The classes are counted from the files (`*.clas.testclasses.abap` under an
input folder), not from a generated index, so a test written and not yet
transpiled is a finding rather than an absence. A test include with **no
class beside it** is named as such, because an include without its class is
not an object at all.

**And it uses the build's own `exclude_filter` rather than a second list.**
Its first run named `ZCL_EDITOR` — a fixture under `test/fixtures/`, with
its own `abaplint.jsonc` and an empty test class that exists so the ADT
editor tests have something to read. It never runs because the build skips
that folder. A check that did not know would have cried wolf on its first
run, and a check that cries wolf stops being read.

Note what this does **not** claim: the rule "a test class without its own
`.clas.xml` does not run" is **false in this tree** — five such classes run
every build (`zcl_osd_rfc_test`, `zcl_stg_gateway_test`,
`zcl_stg_phase0_test`, `zcl_stg_segw_test`, `zcl_stg_shlp_test`). And the
cause is now known rather than merely excluded: **nothing was silenced.**
The class ran with the file and without it — eight methods both times — and
what differed between the two readings was not the file but **how the log
was read**. Two things changed between the runs and only one was noticed,
which is the control an experiment needs and did not have.

### Downloadable SQLite-only Bun releases and protocol consolidation (2026-09-21)

- Ship four independently tested bundles: Linux x64, Linux arm64, Windows x64,
  macOS arm64. Each contains the matching Bun `osd` executable, a matching
  `osd-up` DIAG/RFC bridge, the same prebuilt SQLite generation, and only
  redistributable packs (LSD, vivid-vibes/ZO4D, Zork-mini after checking its
  story/media rights). No HANA, DuckDB, PostgreSQL, or private SAP payloads.
- Package each target as one downloadable archive. Its launcher may extract
  the immutable content on first run into a versioned local cache, but must
  verify checksums, avoid overwriting user data, and work offline after
  download. SQLite data belongs outside the unpacked content and survives
  an archive replacement. A plain extracted archive is an acceptable first
  milestone if automatic extraction would weaken those guarantees.
- Gate each published archive on a native-runner smoke test: unpack, start
  OSD, read and write OData, restart and read the same record, query ADT,
  exercise 32nn with SAP-TUI and 33nn with ADT-over-RFC. If a native runner
  or client is missing, label that target unverified and do not call it a
  release. Publish hashes and exact source/pack revisions.
- Explore moving the DIAG and RFC front doors from `open-diag-go`/`open-rfc-go`
  into JavaScript, not as a prerequisite for the first release. Start by
  inventorying the actual wire surface, NI framing, DIAG tape/APC behaviour,
  RFC metadata and `SADT_REST_RFC_ENDPOINT` codecs; capture protocol fixtures
  and licence boundaries. A JS replacement earns removal of the Go sidecar
  only after the same 32nn/33nn conformance tests pass on all four targets.
- Before a public release, generate and audit transitive dependency notices
  for the compiled Bun and Go binaries, attest binary inputs to exact commits,
  and make Windows extracted generations retain their real hash rather than
  the fallback epoch `1`. Reduce the roughly 10,000 files in the Windows ZIP
  only after verifying ADT rebuilds and bundled packs still work. Test native
  Windows shutdown for both `osd.exe` and its serving child.

### CI time and trigger budget (2026-09-21)

Standard GitHub-hosted runners are currently free for this public repository,
but repeated full image/browser runs still occupy runner capacity and slow PRs.
Measure per-workflow wall time, runner time, queue delay and artifact/cache size
over a representative week before changing gates. Then add explicit path filters
for genuinely unrelated changes, avoid duplicate branch-push and PR runs, and
cancel superseded runs of the *same PR* while preserving main/release runs.
Do not skip lint, ABAP Unit, integration, launchpad/browser or affected image
smoke for runtime changes; never publish Pages before its browser check passes.
Document which file classes trigger each gate and test the filters with sample
docs-only, UI, ABAP, database and image changes. Recheck billing/runner policy
if the repository becomes private or uses larger runners.
