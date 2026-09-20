# The ICF registry: the working plan

*Written 2026-09-20 during the night shift, to be picked up after a context
compaction without re-deriving anything. The **why** lives in
[`icf-as-the-registry.md`](icf-as-the-registry.md); this is the **what, in
what order, and how you know it is done**.*

---

## Re-orienting in four commands

```sh
node tools/osd-nodes.mjs             # the inventory: every node, its type, where it works
node tools/osd-routes.mjs            # the drift: what nothing explains (must be 0, both ways)
node tools/osd-bsp-registry.mjs src  # the BSP applications this tree carries
npm run lint && npm run transpile    # 0 issues, ~12 s, 1530 objects
node tools/osd-unit-run.mjs          # ABAP Unit, prints OK
```

The i7 deployment is restarted with `sh scripts/osd-restart.sh 3030` and
verified by **reading what it serves**, never by the fact that it started.

---

## Where this stands, measured

**The A4H loop is closed end to end.** One YAML becomes a SEGW project, a
DDIC, seed rows, an activated OData service and a Fiori application that a
real system serves at `/sap/bc/ui5_ui5/sap/<app>/`. Every constant it cost
is in [`a4h-deploy.md`](a4h-deploy.md).

On this side, as of `26954cd`:

| | |
| --- | --- |
| `test/segw-tree.mjs` | 20 of 20 (was 8 red at the start of the night) |
| CI | `tests.yml` runs lint + transpile + ABAP Unit + the suites, and **reports what it could not look at**. Before it, no workflow read a test |
| destinations | one registry: a *destination* is a system, a *binding* is who uses it here |
| `POST /osd/status` | an ICF node at `/sap/bc/osd/status/`; the express route is **deleted** |
| BSP | `ZCL_OSD_BSP` serves five Fiori apps and a pack page out of a generated registry |
| scoreboard | 10 ICF nodes, 12 host rivals, 6 mount/wrapper, 1 pack mount, 1 binding |

---

## The three corrections, all Alice's, in the order they landed

**1. ICF is the only *registry*, not the only *router*.** `ICFHANDLER` is a
transparent table keyed by `(icf_name, icfparguid, icforder, ICFTYP)` whose
payload is a handler **name**. The tree does not care what is behind the
name. So the goal is one inspectable truth about what the system is made
of — not one execution model.

**2. Do not imitate the storage, imitate the interface.** Pages went into a
generated ABAP class as base64 (137.9 KB) because a system keeps them in
`O2PAGELINE`. Wrong layer. They are already files in a directory and can
stay there.

**3. What is served by the host can stay served by the host — it only has to
be *declared*.** This dissolves most of the migration backlog. The launchpad
shell, the ADT façade, the dumps, the SQL log: none of them should become
ABAP. `/sap/bc/adt/` is **one node of type HOST**, not thirteen rivals.

The consequence for the falsification: "a registry is migrated when its code
is **deleted**" still holds, and what gets deleted is the **second table of
routes**, not the serving. A host stops carrying `app.get(...)` lines and
starts mounting **what the registry declares**, asking the type what serves
it.

---

## The plan

### B. A handler row carries a type — **done, 2026-09-20**

`ICFTYP` is read (`handlerRows` in `tools/osd-icf.mjs`, a nesting-aware scan
because `ICFHANDLER` names both the row and the field in it). The host-served
paths are declared in `src/icf/nodes.json`. `tools/osd-nodes.mjs` is the one
reader over both, plus two derivations (a pack's page, a destination's
service). Both hosts mount **from it** — `hostNodes` in `test/start.mjs` and
`tools/osd-serve.mjs` — and `reserved = ["/sap/opu/odata", "/sap/bc/adt"]`,
which sat written out in both, is gone: the claimed prefixes come from the
registry.

Measured after: 30 nodes (18 ABAP, 10 HOST, 1 PROXY, 1 with no handler),
**0** express registrations nobody declared, **0** declared nodes nothing
serves. The twelve rivals are one HOST node each or gone; the one express
registration left that is a route of its own is the `X-OSD-Generation`
header, which decorates.

**Two things this changed in the model, and they are worth keeping:**

*`type` and `travels` are different questions.* `type` is what implements the
node — an ABAP class, a function of this host, another system. `travels` is
whether the **node** is a SAP object, which is exactly whether it was
declared in a `*.sicf.xml`. Keeping them apart is what lets the OData front
say the true thing about itself: its handler is ABAP and its node is not an
object yet. That is a gap somebody should close, not a wording to argue with.

*A node may be attached by code of its own, and it costs a written reason.*
`/sap/opu/odata/sap` is mounted beside the runtime it proxies to — the same
lines start the child, install the dev loop and refresh `ZOSD_STATUS_SRV`
before a read of it. `"mount": "elsewhere"` says so and `"why"` is checked
non-empty by the test, the way `.leak-allow.json` makes an exception cost a
sentence.

**What was left of B, and why it turned out to be wrong.** This said
"write the OData front's own `*.sicf.xml`, so the node travels as well as
the handler". Do not. `/sap/opu/odata/sap/` is a node a real system
**delivers**, served by `/IWFND/CL_SODATA_HTTP_HANDLER`; an object of ours
at that URL would replace it on import and take the system's own gateway
away. Its place is `src/icf/nodes.json`, which is where it already is.

Looking for that object found three that already exist and have the same
problem: `/sap/bc/gui/sap/its/webgui`, `.../sapevent` and
`/sap/bc/ui5_ui5/sap` are ours as `*.sicf.xml` and are SAP's on a system.
We answer on those paths **on purpose** -- OSD is a doppelganger and the
same URL is the point -- so the fix is not to move them but to stop them
travelling, which `SAP_DELIVERED` in `tools/osd-nodes.mjs` now does from
the path rather than from anybody's memory. A child of such a node
(`/sap/bc/ui5_ui5/sap/zosd_008_app/`) is exactly how a Fiori application
reaches a system and is not flagged.

So B is closed, and what is left is the thing it uncovered: **15 nodes
travel and three of them must not**, which is now stated by the inventory
and checked by a test.

### B (as written before it was done)

Was second; promoted by correction 3, because it turns "12 rivals to
migrate" into "0 rivals, 12 declared nodes of known types" without moving a
file.

Types, each saying **where it works** rather than whether it is allowed:

| type | who serves it | works in |
| --- | --- | --- |
| `ABAP` | a class implementing `if_http_extension` | server, binary, browser preview |
| `HOST` | a function of the JavaScript host | server and binary; **not** the preview |
| `PROXY` | a destination, another system | server and binary; **never** the preview |
| `CONTENT` | pages out of the store | everywhere |

Work:

1. `*.sicf.xml` already has `<ICFHANDLER_TABLE>` with `ICFTYP`. Read it
   (`tools/osd-icf.mjs`) instead of ignoring it; today every node is assumed
   ABAP.
2. Declare the host-served paths as nodes. Candidates, from
   `node tools/osd-routes.mjs --list`: `/sap/bc/adt/` (the façade),
   `/app` (the launchpad shell and static), `/osd/dumps`, `/osd/sql`,
   `/osd/serving`, `/segw/generate/:project`.
3. The host mounts **from the registry**: `mountServices` grows a case per
   type, and the hardcoded `app.get(...)` list in `test/start.mjs` and
   `tools/osd-serve.mjs` goes.
4. `tools/osd-routes.mjs` stops counting rivals and starts reporting an
   inventory: node, type, where it works.

**Done when**: the ADT façade appears as one HOST node rather than thirteen
rivals; `reserved = ["/sap/opu/odata", "/sap/bc/adt"]` in both hosts is gone
because the registry says what those paths are; and the scoreboard answers
"what does this system expose and what implements it".

### A. Pages out of the generated class — **done, 2026-09-20**

`zcl_stg_bsp_registry` went from **141 KB to 8.8 KB**: app, page, MIME and a
key, no bytes. Each page is a Web Repository object beside it
(`gen/bsp/*.w3mi.xml` + its data file), read with `WWWDATA_IMPORT` +
`SCMS_BINARY_TO_XSTRING`, answered by `abap.W3MI_LOADER` where there is no
file system. The mechanism was not invented a third time.

Four constants it cost, every one found by running it:

| | |
| --- | --- |
| `WWWPARAMS-OBJID` | **CHAR 40**, not 60. Three of the 33 pages were longer. A long name is cut to the column and `generate()` throws on a collision naming both pages |
| `filesize` in `<PARAMS>` | kills the seed — the transpiler writes one from the data file's real length, so ours was the same key twice (`UNIQUE constraint failed: wwwparams`) |
| the file name | escapes `.` as `%2e`, because abaplint reads an object's **type** out of the file name: `…manifest.json.w3mi.xml` is type `json.w3mi` |
| a stale object | is removed — a generator that only adds leaves a wwwparams row for a page no application has |

Verified by reading what is served: six pages answer 200 with the right
content type, three of them byte-identical to their source files, on the i7
as well.

### A (as written before it was done)

Independent hygiene, not part of routing. 137.9 KB of base64 in generated
ABAP source is wrong on its own terms: assets in code, a transpile on every
image, linear growth per application.

The mechanism exists and is **not** to be invented a third time. Media out of
SMW0 (33 objects, 16 MB) goes: content beside the modules, a `@KERNEL` read
with `abap.W3MI_LOADER` as the host hook, disk as the normal path. See
`.local/lars/open-abap-core/src/w3mi/zw3mi.fugr.wwwdata_import.abap` lines
45-54 for the exact escape.

Work: `tools/osd-bsp-registry.mjs` emits a **list** (app, page, MIME, file)
and no bytes; `ZCL_OSD_BSP` asks a reader for the content.

**Done when**: the generated class is a few KB, changing an image is not a
rebuild, and every page still answers 200 with the right content type.

### C. The registry readable and writable from ABAP — this is G.5

Seeded from `*.sicf.xml`, the way `data/*.tabu.json` seeds tables from
abapGit objects.

**It needed a rule this tree did not have**: what happens when the table and
the objects disagree. That rule is now written, before the table, in
[`registry-drift.md`](registry-drift.md). Its three load-bearing claims:

- **on a real system the objects *are* the table** -- `ICFSERVICE` /
  `ICFHANDLER` are the registry, abapGit writes those rows, and a
  `*.sicf.xml` is a transport rather than a source. So the table is the truth
  at runtime and an object is applied **when it arrives**, not on every
  start;
- so **do not invent `ZOSD_ICF`** -- implement `ICFSERVICE`, `ICFHANDLER`
  and `ICFDOCU`. **The second half of this line was wrong and is
  withdrawn:** "ABAP that reads SICF the way a system does works here
  unchanged" is false. `ICF_NAME` (CHAR 15) and `ICFPARGUID` (CHAR 25)
  match a system; `URL` does not exist on one at all -- a node's path IS
  the parent chain, which is why abapGit reconstructs it with
  `cl_icf_tree=>service_from_url` rather than reading a column. Ours
  denormalises it because this runtime has no ICF tree to walk, so
  `ZCL_OSD_ICF` would not compile on a system. The tables are
  **ICF-shaped**, not ICF's, and deriving the path from `ICFPARGUID` is
  the later step that would make the claim true. Caught by an adversarial
  review, 2026-09-20, after the claim had been repeated in three commit
  messages;
- the disagreement keys off **who last wrote the row**, `SEEDED` or
  `EDITED`, and an edited row an object contradicts is **replaced, kept
  aside and reported** -- the shape the schema-drift rule already has.

It also names why this matters at all: `data/*.tabu.json` is re-seeded on
every generation change, which is right for a fixture and would make the
registry screen a toy. Configuration and seed data look identical in SQLite
and are not the same thing.

What is still open in the rule is where "aside" *is*: a moved-aside database
is a file with a name, and a moved-aside row needs somewhere to be that
survives the restart which produced it.

**Done when**: changing a node from a screen changes what answers, and a
disagreement between the table and the objects is reported rather than
resolved in silence.

**Both halves measured, 2026-09-20.** The serving runtime mounts from
`ICFSERVICE`/`ICFHANDLER` rather than from the files, and the falsification
was run rather than argued: `UPDATE icfservice SET icfactive = ' '` on
`/sap/bc/zork/`, marked edited, recycle -- that path answers **404** and the
untouched `/sap/bc/osd/rfc/` still answers 200. The first attempt at the
same experiment blanked the object hash instead of using `markEdited`, and
the start correctly set the edit aside with
`zosd_icf_aside.why = "the row was edited here and the object now says
something else"`, which is the rule catching the experimenter.

**Both are closed.** The screen is `/sap/bc/osd/sicf/` (`ZCL_OSD_SICF`),
and the parent stopped keeping a list: in child mode it forwards
`/sap/bc/*` minus what a declared node owns and lets the child decide,
because the child holds the registry. Proved with a node that exists
**only as a row** -- `/sap/bc/osd/onlyrow/`, named by no file anywhere --
which answers 200 and appears on the screen. Under the old shape it would
have been unreachable however correctly the registry described it.

### What this uncovered, and it is not small

**Nothing the serving runtime says is ever printed.** `tools/osd-runtime.mjs`
spawns the child with `stdio: [ignore, pipe, pipe, ipc]` and keeps the last
4 KB as a rolling tail, used only to explain a failure to start. So the
registry's apply report -- "no object explains it", "kept aside" -- is
produced, returned, and seen by nobody in the deployed configuration. The
same is true of every `runtime error:` dump line the child logs.

"Never silently" is half the drift rule and it does not currently hold where
it matters most. The tail is capped on purpose (the demo writes a line a
frame; `docs/demo-profile.md`), so blanket forwarding would reopen a cost
somebody measured. Two honest ways out, and the first is probably right:

- the child already has an IPC channel (it sends `{type: "ready"}`), so a
  `{type: "say"}` for the few things that must be said is precise and cheap;
- or the report goes where a person already looks -- the screen -- which is
  this session's own lesson about checks nobody reads.

---

## Deliberately not in the plan

- **Porting the JS parts to a real system.** The ADT façade is meant to be
  JS; A4H has ADT, the façade imitates it.
- **Moving the launchpad shell's files.** About forty references in a dozen
  files, including two e2e suites, the Easy Access screen's ABAP and the
  preview. Correction 3 removes the need: it is declared, not moved.
- **`/app` going away.** It follows from B, it does not lead.
- **The Fiori scaffolding writers** (`@sap-ux/*-writer`, Apache-2.0, 8–16
  deps). Worth **one run as an oracle** — diff their manifest against ours,
  which would also settle whether our app is missing something the app index
  needs — and never as a dependency. Parked with the launchpad tile Alice
  deferred.
- **CDS-BOPF and RAP**, still behind the HANA path being released.

---

## Traps already paid for tonight — do not re-pay them

- **An instrument that answers a question nobody asked.** The scoreboard said
  23 rivals, then 12, and is 15 in the shape that counts everything: it had
  been calling `app.use(facade.router)` "plumbing" and counting no plumbing,
  so the largest rival was invisible to the tool built to find rivals.
- **A regex over source is not a measurement.** `needs()` matched
  `status\b`, which is `res.status(500)` in an error branch, and filed three
  routes as process state. Verdicts are **declared** now, with a reason each,
  and an unjudged route is an error rather than a default.
- **A test that cannot go red.** `some(none) || every(some)` is true of every
  input. One was written and reverted the same night; a sibling survived and
  was found by review.
- **A ratchet whose number depends on a gitignored file** is not a ratchet:
  locally 15, on a runner 14, ceiling 15.
- **The exit code of a pipeline is the last stage's.**
  `node tools/osd-suites.mjs | tail -6` returns `tail`'s zero. `tests.yml`
  sets `shell: bash` for `pipefail` once, for the job.
- **A number measured in a configuration the instrument does not work in.**
  The first full suite run said 25 failing; it ran on the port the live
  deployment holds, so twelve were "before all" hooks. On a free port the
  same tree is 1036 passing, 5 failing.
- **Committed, pushed and built are three states.** Each of the three cost an
  hour tonight, once each, to each session.
- **`git add -A` before a stash sweeps untracked files.** Six left the tree
  and were only noticed when a script went missing. Compare the `??` list
  before and after.
- **Equal ignorance keeps two implementations equal.** A twin test goes red
  when one twin gets *better*, so the alarm fires on the improvement and
  reads like a regression. A fixture is a twin too, and it drifts by standing
  still — three fixtures in one night did not look like the thing they stood
  for.

---

## The state of the other session

`fable-osd` finished the ABAP generator's text-element port (`9289674`,
"The twin is equal again") and pushed before her session ended. Open items
that were hers and are now unowned:

- the **preflight** (`f593d77`): built, with the request body isolated behind
  `BODY_IS_OBSERVED = false` because the wire form was never measured. The
  way to measure it is to point vsp's `--url` at `tools/osd-tls-proxy.mjs`
  and read the dump — keep the dump under `.local/`, `*.jsonl` is gitignored
  because captures carry logons;
- **R.2**: one call to `SADT_REST_RFC_ENDPOINT` with a non-ADT path, which
  decides whether that track reaches services at all or only ADT. A4H, so it
  is Alice's word;
- correcting the count in her own note, which this plan's parent commit
  already did.
