# Backlog

Everything open, as a tree, with who owns it and what it waits on.
Written 2026-09-13. `AGENDA.md` stays the narrative record of what was
decided and why; this is the list.

Owners: **S** open-steamgate (this session's repository), **T** the
transpiler session (`src/segw/**`, the ABAP generators, connectivity, APC),
**V** vsp (the Go bridge, the only thing that touches a real system),
**A** Alice — a decision nobody else can take.

---

## 0. Decisions waiting on Alice

Nothing below them starts until the answer.

```
0.1  Bun "local ABAP AS" packaging: yes / no                          [A]
     └─ unlocks 1.1, 1.2, 1.3
     └─ feasibility settled 2026-09-13: bun 1.4.2 runs the whole thing,
        107 ABAP Unit tests and the gateway over HTTP, docs/bun-spike.md
     └─ external: the %23 specifier defect blocks it until worked around
        (ANOMALY-2026-09-13-bun-percent-encoded-specifier)
     └─ external: open-abap-apc (T's, local only, no remote) for the APC layer
     └─ settled already: it lives in this repository, not a third one

0.2  ADT façade: ANSWERED YES by Alice 2026-09-13, building              [A]
     └─ the contract for waves 0 and 1 is written: docs/adt-facade.md
     └─ unlocks 2.1 .. 2.4
     └─ external: open-abap-adt (interfaces only, LICENSE empty -> spec, not base)
     └─ external: vsp as the oracle and the test client
     └─ external: sanitized ADT fixtures from V; this repository is public,
        so raw captures never come here, V scrubs before handing over

0.3  A4H: what goes up, and when                                      [A]
     ├─ level 1  the SEGW project as an abapGit repository (13 files)
     ├─ level 2  + DDIC, seed data, search help, the hand-written _EXT
     ├─ level 3  + the Travels app as a BSP (three changes, AGENDA)
     └─ needs: package name, transport, the word
     └─ external: A4H sandbox, abapGit installed on it

0.4  draft oracle: build the sample objects on A4H?                   [A]
     └─ plan: docs/oracle-draft.md
     └─ external: A4H; a browser to capture $metadata (MCP cannot)
     └─ risk named there: the writable draft service may not be a SEGW artifact

0.5  RAP oracle: build the sample objects on A4H?                     [A]
     └─ plan: docs/oracle-rap.md
     └─ external: SAP-samples/abap-platform-refscen-flight (Apache-2.0) is
        most of the oracle already; A4H only adds the 1909 BDEF dialect
     └─ external: A4H 1909 is unmanaged-only, no managed, no draft

0.6  Is depending on ZADT_VSP being installed on the target ok?       [A]
     └─ decides V's deploy route (2. vs 3. on the ladder in 4.2)

0.7  What S does while the above is open                              [A]
     └─ proposal: the analytics chain, 3.1
```

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
     └─ external: the %23 specifier defect, which a compiled binary
        inherits; transpiler #1841, open, waiting on Lars to pick the
        replacement character [T]
     └─ known: mainstream platforms only, ~60-100 MB per exe
1.4  APC over Bun websockets                                          [T]
     └─ open-abap-apc as an outside library, cloned into .local/lars
     └─ not gated on Lars: the library ships its own copy of the SAP-named
        part today and works; the PR (9.4) only makes it prettier
```

## 2. The ADT façade (gated on 0.2)

Not "flip a URL and 96 tools work". It is "flip a URL and iterate one
subset at a time against vsp", whose client is strict on purpose. Order
below is V's, and it is the order that matters: the session comes before
the objects.

```
2.1  session and CSRF emulation                                  [S] DONE
     ├─ the token dance: HEAD/GET fetch, x-csrf-token on writes
     ├─ X-sap-adt-sessiontype stateful / stateless, sap-contextid, cookies
     ├─ an affine session for lock -> write -> activate
     └─ expiry by shape: a 200 without a token reads to vsp as logged out
     └─ V's warning: this breaks first, so it is built first
2.2  discovery as the gatekeeper                                 [S] DONE
     ├─ /sap/bc/adt/discovery advertises only what is implemented
     └─ so vsp never calls an endpoint that 404s, and "which tools work"
        has one honest answer
2.3  thin vertical slice, one day                                [S] DONE
     ├─ discovery + the session dance
     ├─ GetSource for a class, from the files in src/ and gen/
     └─ GetTableContents, from the database we already have
     └─ exit test: vsp pointed at localhost, its own tools answer
2.4  reads: programs, classes, interfaces, tables, packages, search
                                                                 [S] DONE
     └─ and the cross-reference tables over freestyle SQL: free on the
        protocol side, filled from the parse by the store layer        [T]
2.5  writes: source in, abaplint as the syntax check, transpile as
     activation, ABAP Unit as the test run; synthetic locks, no
     transports                                                       [S]
2.6  runtime errors as ST22-shaped dump documents                     [S]
     └─ V's freebie: `vsp dumps --explain` then works with no system
2.7  honest scope: the development loop, some thirty to fifty of the
     ninety-six tools. Transport organiser, job and spool, identity,
     debugger over ADT and real cluster dumps stay out and stay
     undiscovered.                                                    [S]
     └─ external: sanitized ADT document shapes from V (see below)
```

## 2a. OSD: the tiers, and who owns which layer

The local system, working name OSD, the off-stack doppelganger. The tiers
say **when**, the layers say **who**; they are the same picture from two
angles and both were agreed across the three sessions on 2026-09-13.

```
Tier 1  OSD speaks ADT well enough for vsp
        waves 0-4 above, plus abapGit in a box as the way content gets in
        gate: vsp's wave 0-4 tools green against localhost, AND
              open-steamgate's own suites unchanged with the facade in
Tier 2  OSD speaks ADT well enough for Eclipse
        a much larger surface; the honest milestone is "connects, logs on,
        browses the tree, reads sources", not "works"
        needs an Eclipse oracle: the request sequence can be had by pointing
        Eclipse at the facade and iterating on 404s, but the expected
        responses need one Eclipse session against A4H        [A]
        rule: such a capture stays in .local/, never in this repository
Tier 3  OSD speaks the rest: RFC and DIAG fronts, a screen that answers
        "not implemented" instead of nothing
        not ours to build: odgp already draws screens from Go with no
        system behind it, and the DIAG sibling carries the LZH writer
        (docs/layers-we-own.md). The spike is "can odgp answer a screen
        routed from OSD", and it is odgp's question
```

```
Layer                      Owner  What
protocol surface           S      the ADT facade: session, discovery, the
                                  resource tree, content handlers, ETags,
                                  locks; and the packaging that ships it
the object service seam    S      drafted as part of the facade contract:
                                  read, write, activate, delete, list,
                                  search, and the shape activation returns
                                  for an error. The facade never touches
                                  storage, the store never parses HTTP
what is behind it          T      the object store, the activation path
                                  (file, abaplint, transpile), abapGit in
                                  a box, APC and daemons
the client and yardstick   V      the calls a real development loop makes,
                                  the sanitized fixtures, the round trip
```

## 2b. Questions parked next to the façade

```
open  SOAP: vsp's ADT is pure REST, no SOAP in it. The only SOAP it touches
      is SOAP-RFC (/sap/bc/soap/rfc), a fallback transport for classic RFC
      when the gateway is closed, stateless, and it belongs to open-rfc-go.
      A local system would need it only if a non-ADT, RFC-speaking client
      had to attach. Question, not an item.
open  Eclipse ADT against the façade: free if vsp accepts it, untested.
open  revisions: reading them out of git instead of a system.
```

## 3. Analytics and CDS (no gate, S can start)

```
3.1  star schema                                                      [S]
     ├─ @Analytics.dataCategory: #DIMENSION / #TEXT
     ├─ @ObjectModel.text.element, foreign-key associations
     └─ so the analytical list page shows names, not codes
3.2  view parameters                                                  [S]
     └─ parameterised entity sets in OData v2
3.3  delta extraction (the BI piece)                                  [S]
     ├─ @Analytics.dataExtraction.enabled, delta by a timestamp element
     ├─ !deltatoken on the service, __delta in the answer
     └─ a change-log table our own writes fill, so deletions are in the delta
3.4  calculated measures over the virtual-element exit                [S]
     └─ free now, docs/virtual-elements.md
```

## 4. The road to a system

```
4.1  capture IN: DDIC + table contents from a system into our files   [V]
     └─ this is the thing we lack: our DDIC and seed rows are hand-made
     └─ external: rfc export (abapGit ZIP) + Data Config, both exist in vsp
4.2  deploy OUT, as a ladder                                          [V]
     ├─ rung 0  abapGit on the box pulls the repository itself   (nothing to build)
     ├─ rung 1  vsp deploys CLAS + DDIC; IWMO/IWSV registered by hand once
     ├─ rung 2  vsp triggers abapGit deserialize        (gated on 0.6)
     └─ rung 3  vsp learns IWSV/IWMO/IWPR natively      (only if install-free
                deploy becomes a promise)
4.3  two bundles, never conflated                                     [S+V]
     ├─ out: classes, DDIC, registration objects
     └─ in: DDIC + table contents; data/*.tabu.json does not go back
```

## 5. SEGW, the application (T's, with my editor on top)

```
5.1  the wizards SEGW has                                             [S]
     ├─ import from a DDIC structure
     ├─ map to a data source
     └─ referential constraints, complex types, data sources by hand
5.2  node order, drag and drop (STG_SEQ)                              [S]
5.3  a text row created when there is none                            [S]
5.4  Generate into src/ and a registration without a restart          [S+T]
5.5  the informational Cloud abaplint pass, numbers per release       [T]
```

## 6. Gateway leftovers (S)

```
6.1  media: CREATE_STREAM with a slug, deleting a media resource,
     ETags, streaming instead of one xstring
6.2  deep insert through a projection (a composition)
6.3  ETags on a CDS projection
6.4  @ObjectModel.readOnly per element
```

## 7. stg-compile leftovers (S), blocked on an oracle

```
7.1  Include: a model that merges another service's model
7.2  a function import mapped to a function module
     └─ neither has a corpus example; both need a small sample project
        built on A4H (0.3 / 0.4 territory)
```

## 8. Housekeeping (S)

```
8.1  e2e data isolation, so the suite can run in parallel again
     └─ today: workers: 1, deterministic, 44 seconds
8.2  the flaky value-help spec, seen once, not reproduced
8.3  keep the preview build green (it broke twice on bundling)
```

## 9. Upstream, outside this repository (T's, verbatim from them)

```
9.1  transpiler #1835, @abaplint/database-duckdb                      [T]
     └─ open since 2026-09-12, checks green, no review
     └─ external: Lars merges; PR only, never merge ourselves
     └─ blocks nothing here; the branch feat/database-duckdb lives until then

9.2  transpiler: a release after 2.13.86                              [T]
     └─ external: Lars publishes; #1836 (flat concat chain) is merged but
        not on npm
     └─ unblocks 9.3, and lets both generators drop the 200-line SADL rule
        (segw-gen's sadlXml and my zcl_stg_segw_gen_dpc)

9.3  open-abap-core: BAPI_TRANSACTION_COMMIT / ROLLBACK over the LUW   [T]
     └─ written, eb0bedd on branch bapi-transaction in the fork, unpushed
     └─ waits on 9.2, then PR, then the commit_work test in open-abap-odata
     └─ external: Lars merges

9.4  open-abap-core: the APC family a real handler needs               [T]
     └─ core's if_apc_wsp_extension has two methods, a stateful handler
        needs five (on_accept, on_close, on_error) and if_apc_wsp_message
        needs set_text; cl_apc_wsp_ext_stateful_base does not exist
     └─ written and tested in open-abap-apc, not yet a PR
     └─ external: Lars merges; until then open-abap-apc ships its own copy
        and leaves core's src/tcp out of its dependency

9.5  oisee/vivid-vibes: 154 unimplemented interface methods           [A/T]
     └─ zif_o4d_effect declares get_required_media and one more; 2 of 85
        effect classes implement them, so 75 classes do not transpile
     └─ external: Alice's repository, a patch there is the fix
     └─ blocks only the demo payload for APC, nothing structural

9.6  Bun, measured rather than assumed                                [T]
     └─ done in part 2026-09-13: it runs, and twenty reads took 220 ms
        against Node's 264 ms (docs/bun-spike.md)
     └─ still open: the three request shapes (100/20, 1000/100,
        5000/100 rows) so the brief has Bun beside Node 2 ms and goja
        36 ms on the same axis
     └─ confirmed: Bun is JavaScriptCore, not V8
```

---

## External dependencies, all of them in one place

```
Lars / abaplint
  ├─ transpiler #1835 (DuckDB driver)          open, see 9.1
  ├─ transpiler #1836 (flat concat chain)      merged 2026-09-13
  ├─ transpiler #1841 (%23 breaks Bun)         open, blocks 1.3
  │   └─ when it reaches npm, SADL_CHUNK can go from both generators
  ├─ open-abap-odata                            license still "todo"
  │   └─ we reimplement, contribute fixes, do not fork
  ├─ open-abap-adt                              license empty, interfaces only
  └─ open-abap-core                             T's APC PR, not written yet

SAP
  ├─ A4H sandbox            only on Alice's word, MCP is read-only
  ├─ abapGit on the box     the blessed last mile
  ├─ SAP-samples/abap-platform-refscen-flight   the RAP oracle, Apache-2.0
  └─ SAPUI5 1.120.50 from the CDN               the apps' runtime

Tooling
  ├─ bun 1.4.2              installed (~/.bun), runs everything
  ├─ Go 1.26                installed (used for the goja spike)
  └─ npm, pinned by the lock file

Known defects we live with
  ├─ no implicit MANDT in the transpiler        ANORMALIES, T0009 kept visible
  ├─ bun does not decode %23 in a specifier     transpiler #1841, blocks 1.3
  └─ Bun runs JavaScriptCore, not V8            corrects the vision draft
```
