# Handover — start here

*2026-09-20. Written to be picked up cold — by another Opus session, by
codex, or by a person — without re-deriving anything.*

**This file is the entry point.** Two more sit under it and neither repeats
it:

- [`handover-2026-09-20.md`](handover-2026-09-20.md) — the **ICF registry
  track** in depth, from the other session: what is open in the order it
  unblocks, the write path, and what is recorded rather than fixed.
- [`backlog.md`](backlog.md) — the whole board, and
  [`icf-registry-plan.md`](icf-registry-plan.md) — that track's plan.

**Everything below is measured, and says where. Where something is an
inference it says so** — the most expensive hour of this day went on a
sentence that explained a decision well and had never been checked.

---

## Re-orient in six commands

```sh
npm run transpile                    # ~10 s, ~1600 objects. DO THIS AFTER EVERY PULL
npx abaplint                         # 0 issues expected
STG_PORT=3141 npm run integration    # the wire suites -- PIN THE PORT, see below
node tools/osd-nodes.mjs             # who answers which path, and what implements it
node tools/osd-routes.mjs            # the drift: must be 0 in both directions
node tools/sqlscript-conformance.mjs # every engine against HANA, a class per difference
```

Three preconditions to reading any of those numbers, each bought today:

- **Pin the port.** 3030 is the running deployment, and a suite run against
  it reports twelve "before all" failures that are not failures.
- **`synchronized` is only readable when the tree is quiet.** Two suites
  write into `src/` while they run and restore afterwards
  (`test/adt-devloop.mjs`, `test/cds-check.mjs`), so the generation hash moves
  while they do. Verify a deployment *after* the suites, never beside them.
- **Rebuild, then restart.** Restarting without rebuilding serves the
  previous generation under the new commit, which reads as correct if you only
  check the commit. Then read `/sap/bc/adt/core/http/build` and require
  `synchronized: true`.

A deployment is verified by **reading what it serves**, never by the fact
that it started.

---

## Where the work stands, measured

At `dbaef4d`, both sessions' work in:

| | |
| --- | --- |
| integration | **1211 passing, 0 failing, 7 pending**, 104 suites, 0 EADDRINUSE |
| lint | abaplint **0 issues**, 548 files |
| ICF | **30 nodes**, 0 express registrations nobody declared, 0 declared nodes nothing serves |
| SQLScript | **9** rows differ from the HANA oracle, 9 have a treatment, **0 unwatched** |
| grammar | 32 classes, 38 dispatched names, 5 allowed unnamed, **0 undecided** |
| deployment | GitHub Pages and the i7 both serve from `main`; Pages rebuilds in ~140 s |

**The suite number is a property of the machine as well as of the tree, and
the difference is named rather than averaged.** This machine answers 1211
passing with 7 pending; the i7 answers 1215, because all seven pending cases
need a **live HANA** and some of them find one there. Two more inputs work
the same way: `.local/corpus` and `.local/corpus-sap` (the SEGW oracles) and
`.local/a4h-export` (the SQLScript corpus, i7 only —
`tools/sqlscript/run-corpus.mjs` cannot run without it).
`node tools/osd-suites.mjs --report-skips` prints what a run could not look
at, before and after, so two green numbers from two machines stay two
different claims instead of one standing in for the other.

The build order from CLAUDE.md (substrate → model registry → `$filter` →
wire → Fiori Elements) closed long ago. W.1 (a branch of a whole system) and
G.10 (the SQL trace) are closed. G.5 (SICF as a real application) closed on
2026-09-20, both halves.

## The two lanes

Two sessions work this repository at once and split by **what each already
has in hand**, so neither is in the other's files.

The other session parked its lane on 2026-09-20 and left
[`handover-2026-09-20.md`](handover-2026-09-20.md) for it.

- **osg-osd-i7** — the router and the hosts, G.5 + WAPA, `test/unit/`, the
  exporters, the destinations registry, the preview and Pages.
- **fable-osd** (this one) — the SQLScript front end and its oracles, the
  SEGW generators (`zcl_stg_segw_gen` and the JS twin) and the model, the
  preflight, the test harness.

The protocol, and it is worth keeping: **a tick pulls, and if the other side
moved or wrote, you say nothing and go to your own work.** Only two quiet
ticks in a row earn one message asking what is blocking. It was used once
today and the answer was useful both times it was sent.

Before a question reaches Alice, ask a second opinion:
`codex -m gpt-5.6-sol exec -s read-only '<question>'` from the repository
directory. Measured 2026-09-20: it reads files inside **and outside** the
working tree; `-s read-only` is worth passing, because the default is
`workspace-write` and the working tree is ours.

---

## What is open, in order, and what blocks each

### Needs one run on a system (Alice's word, A4H only)

1. **Does SEGW label an action that has no label?** Create an action in SEGW,
   type no label, regenerate the `_MPC`, look for
   `lo_action->set_label_from_text_element(` after `create_action`.
   *Why it matters:* our rule gives the action its own NAME when the tree has
   none, which produces the bytes measured on A4H — but our tree always
   carries a label, because `stg-compile` writes one. The one real
   SEGW-generated `_MPC` in the corpus with actions (`ycl_slpm_mpc`) has 39
   property labels, symbols 001-039 contiguous, a pool of exactly 39, and two
   actions with four parameters carrying **no symbol at all**. Both hold if
   SEGW emits only when the tree carries a label. A second opinion agreed the
   rule must not be changed on that inference (see `tools/segw-gen.mjs`).
2. **What does an abapGit import do with a node whose URL is SAP's?**
   `/sap/bc/gui/sap/its/webgui`, its `sapevent` child and `/sap/bc/ui5_ui5/sap`
   are ours as objects and SAP's on a system. It might nest, collide or fail;
   "it would replace SAP's handler" was asserted three times and is **not**
   established. Packaging refuses them meanwhile.
3. **The ADT `checkruns` wire form.** `tools/osd-preflight.mjs` is built and
   its request body is constructed from documentation, not observed:
   `BODY_IS_OBSERVED = false`, and the tool says so in its own output. To
   measure: point vsp's entry in `.mcp.json` at `tools/osd-tls-proxy.mjs
   --dump`, make one call, read the dump. **The dump carries a logon and
   never leaves `.local/`.**

### Needs a machine that has something

4. ~~**`dec_mult`**~~ — answered 2026-09-24 on HXE (2.8900, scale s1 + s2);
   the SQLite rounding now covers `*` (`docs/sqlscript-hana-observed.md`,
   "Decimal arithmetic").
5. **The SQLScript corpus** lives on the i7 (`.local/a4h-export`), so
   `tools/sqlscript/run-corpus.mjs` cannot run on the other machine. 78 of
   364 bodies reach an engine.

### Unblocked, from the board

- **G.8 wave 3** — the CDS half of the editor: activating a view means running
  `cds2ddic`, not only transpiling; a class edit changes one object and a view
  edit changes three generated ones.
- **D.3 second half** — the type graph on `/sap/bc/osd/rfc/functions/<NAME>`.
- **incremental transpilation** — the only lever that moves the editor's ~12 s
  save.

---

## The rules this tree paid for, shortest form

Each of these cost at least a day, most of them more than once. They are the
reason the instruments in this repository complain in both directions.

- **Committed, pushed and built are three states.** A suite runs the last one.
  Transpile after every pull. This cost an hour today, and it was the third
  separate day.
- **A true answer to a question nobody asked.** A green run over 90 of 101
  suites. A byte comparison between two implementations that are both blind.
  "0 differences" against a stand-in oracle. The instrument is right, the
  reading is true, and the question is not the one being answered.
- **Equal ignorance keeps two implementations equal.** A twin test fires on
  the *improvement*, not on the shared gap. A fixture is a twin too, and it
  drifts by standing still — the SEGW fixtures had no function import at all,
  so no tree in the suite could express what both generators ignored.
- **Never trade a measurement for an inference.** Twice today a written change
  was reverted because the thing it would replace had been measured on a
  system and the thing replacing it had not.
- **A rule about what every caller must do does not live next to one caller.**
  It lives in a module they all import. Three hosts, one dialog step; twelve
  suites, one port.
- **Reading and running find different things.** The grammar comparison found
  `TableFunctionCall` by reading; one `compile()` call proved it lowered to
  `FROM "MY_FUNC"`, which reading could not, because that looks like working
  output.
- **An exception costs a written reason.** `.leak-allow.json`, `NOT_NAMED`,
  `"mount": "elsewhere"`. One exception with a reason is a rule; three without
  one are a list, and a list is what drifts.
- **Nothing read is not a pass.** Every instrument here exits non-zero when it
  could not look, instead of printing the clean line.

---

## Traps in the tooling itself

- `pkill -f <pattern>` matches the agent's own shell and kills the session
  (exit 144). Kill by PID, found through `ss -lptnH`.
- `cmd | head` and `cmd | tail` return the pager's exit code, not the
  command's. Set `pipefail` or check the file.
- `git add -A` before a stash sweeps untracked files out of the tree.
  Compare the `??` list before and after; `git show --stat HEAD` before a push.
- The leak scan takes its file list from git, so it cannot see what is not
  tracked. For a draft under `.local/` about to be pasted somewhere public:
  `node tools/osd-leak-scan.mjs --paths <path>`. It exits 2 when it read
  nothing rather than printing the clean line.
- A server that must outlive a command is started `setsid nohup … & disown`.
- The harness's background tasks are reaped when the session ends.

---

## What must not happen

- **No live identifiers in any tracked file** — hostnames, users, IPs,
  transport IDs, customer namespaces. Operational scratch lives in `.local/`.
- **Never commit captures** (`*.pcap`, `*.jsonl`); they carry logons and
  session GUIDs. Protocol facts belong here, recordings do not.
- **A4H only when Alice asks**, never a productive or customer system, never
  unasked. The host lives only in `.mcp.json`.
- **Upstream is gated by a critic, not by an ask**: before an issue or a PR
  goes to abaplint / open-abap, a separate agent reads the drafts against the
  branch diff. A merge, a force-push over somebody else's work, or a push to a
  repository that is not ours still asks first.
- **Clean-room**: reimplement the `/IWBEP/` interfaces, bundle no SAP source.
