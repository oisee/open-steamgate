# AMDP, cut out and run in a real HANA

Backlog B.19. The idea is Alice's and it is the whole reason the track is
cheap: **an AMDP body is already valid SQLScript.** So we do not transpile it.
We cut it out of the ABAP class, wrap it in a `CREATE PROCEDURE`, and let a
real HANA execute it.

That sidesteps the thing that would have made this expensive. Measured on A4H
on 2026-09-18: of the 195 classes implementing `IF_AMDP_MARKER_HDB`, the three
customer ones are ours, and one of them — `ZCL_Z80_00_CPU_AMDP` — is a Z80
processor written as four SQLScript procedures, with eighteen `DECLARE`s,
thirty-six `SELECT`s and three loops in a single method. Interpreting that
would mean writing an engine for a second language. Handing it to HANA costs
a connection.

**The HANA is HANA Express in docker on the i7, and deliberately not the A4H
one**: that database is the sandbox the oracle work depends on, and our schema
has no business in it.

## The two halves

`tools/amdp-extract.mjs` — the scissors.

```
node tools/amdp-extract.mjs <class.clas.abap> [--types <file>]... [--procedure]
```

It finds every method declared `BY DATABASE PROCEDURE FOR HDB`, takes the body
**by source position** and the signature from the parsed class definition.

Two things in there are not obvious and both were measured rather than assumed:

- **The body comes out by position, not by concatenating tokens.** abaplint
  parses an AMDP body as a run of `NativeSQL` statements, and their
  concatenated tokens do not reproduce the source — they overlap. The body is
  therefore the text between the end of the `MethodImplementation` statement
  and the start of its `ENDMETHOD`.
- **Parameter types are read off the definition line.** abaplint's parsed
  class definition gives each parameter its name and direction but not its
  type, because a type needs a resolved registry with the DDIC in it, which a
  class read off a system does not have. The parameter's own token carries its
  row, so the type text is taken from that line.

Types a signature uses often live somewhere else — the Z80 CPU keeps its in
`ZIF_Z80_00_AMDP_TYPES` — so `--types <file>` contributes another object's
`TYPES`, and the class's own win a name they share. A table type becomes a
HANA `TABLE(...)` column by column; an unknown type comes back `undefined`
rather than guessed, so the caller refuses instead of generating a procedure
that will not compile.

`tools/amdp-run.mjs` — the other half.

```
node tools/amdp-run.mjs <class.clas.abap> <method> [--types <f>]... [--in name=json]...
```

It connects with the npm driver `hdb`, creates the schema if it is absent,
replaces the procedure and calls it. The connection comes from `HXE_HOST` /
`HXE_PORT` / `HXE_USER` / `HXE_PASSWORD`, or from `.local/hxe-password`, which
is where the laboratory's password lives and which is not tracked.

## The laboratory

`~/hxe/run.sh` starts it. The data is in a bind mount rather than the
container's writable layer, which is the lesson `~/dev/a4h/CLAUDE.md` paid for
twice: the database then survives `docker rm` and Portainer's Recreate, and
overlay2 does not copy a multi-gigabyte file in full on first write.

Ports 39013 (SYSTEMDB), 39017 (tenant) and the instance's own ranges. None of
them collide with 30213/30215, which are the A4H instance forwarded from i5,
nor with 3030, which is the showcase.

**The database is already outside the container, and by HXE's own convention
rather than by our arrangement.** `~/dev/a4h/a4h-lite.sh` exists because the
A4H image keeps `/hana/data` and `/hana/log` in the writable layer — 38.3 GB
that `docker rm` destroys, and that overlay2 copies in full on first write.
HXE does not have that problem: it persists everything under `/hana/mounts`,
which is the one directory the published recipe tells you to bind. Measured
on 2026-09-18: `/hana/mounts` holds **3.7 GB** and the container's writable
layer is **73.6 kB**.

So a snapshot of this laboratory is a copy of `~/hxe/mounts` with the
container stopped, and recreating the container keeps the database. Worth a
script in `a4h-lite`'s spirit if we start needing clean states between
experiments; it is in the backlog rather than built, because nothing needs it
yet.

Two traps met while measuring this, both the same shape: `du` run as the
ordinary user reports **4.0K** for `~/hxe/mounts/data` and **1 MB** for
`/var/lib/docker`, because it cannot descend into directories owned by
`12000:79` or by root. Neither number means "nothing is there". Measure from
inside the container, or with `docker system df`.

**The failed syscall check needs no action on this machine.** HANA reports
`Check failed: syscalls` for `move_pages` and `mbind`, and tells you to get a
profile with `docker run --rm <image> --print seccomp.json`. That command
does not exist in this image — `--print` accepts only `README` and
`hdb_version`, and without an argument it dies with `line 331: $2: unbound
variable`. It does not matter here: those two calls place memory pages across
NUMA nodes, and this machine has **one socket and one NUMA node**, so there
is nothing to place. On a multi-socket host the profile would have to be
built by hand from docker's default plus those two entries, since the image
will not produce one.

## What is not solved yet

- **Where the data is.** A body that selects from a table needs that table to
  exist in HANA with our rows. `ZCL_VSP_00_AMDP_TEST` does not — it computes
  from `DUMMY` — which is why it is the first specimen. Everything past it
  needs either mirroring the tables a procedure touches, or a copy of the
  schema in HXE. **How we intend to find out which tables those are is
  settled, and it is not by parsing** — see below.

## Which tables a body touches, and why we do not parse to find out

Researched 2026-09-18. Two things came back, and the negative one is the more
useful.

**There is no open-source SQLScript parser we can use.** Checked by reading
the listings rather than by searching: `antlr/grammars-v4`'s `sql/` directory
holds twenty dialects and none is HANA or SQLScript; `sqlglot` has no
`hana.py` in `dialects/`; `node-sql-parser`'s dialect list has no HANA.
Pygments, highlight.js, Prism, CodeMirror and Monaco ship no SQLScript lexer.
`abap-fs` uses `larshp/vscode-abap`, which is ABAP only — the hunch was worth
checking and came up empty. The only thing claiming real SQLScript support
with dependency extraction is commercial and closed.

The nearest relatives are Oracle's `plsql` grammar and Hive's `hplsql`, which
have the right *shape* (DECLARE, blocks, loops) and the wrong dialect;
adapting either is a grammar-writing project, not a configuration.

**`SYS.OBJECT_DEPENDENCIES` exists but does not answer our question.** It does
list a procedure's base objects, with `BASE_OBJECT_NAME` and
`DEPENDENCY_TYPE`. But it only exists **after a successful `CREATE
PROCEDURE`**, and a SQLScript procedure with static SQL compiles at creation
time, which needs the referenced tables to be there already. So it is audit
after the fact, not a pre-flight answer. It is also blind to dynamic SQL.

**So the plan is to let HANA tell us, iteratively.** Attempt the `CREATE
PROCEDURE` against our schema; when it fails, the compile error names the
object that is missing; mirror that one and retry. Because SQLScript is
compiled statically, this surfaces **every statically referenced table**,
including ones in branches that would never run — which is better than a
runtime trace would give, and better than a hand-written parser without real
effort. The set is cached per body: it is a one-time cost per AMDP method,
not a per-call cost. A regex pre-pass over `FROM` / `JOIN` / `INTO` seeds the
first guess to cut the number of failed round trips, and
`SYS.OBJECT_DEPENDENCIES` is the cross-check afterwards that the set was
complete.

**The load-bearing assumption is that `CREATE PROCEDURE` refuses when a
referenced table is absent, and names it.** That is measurable and has not
been measured yet. It is the first thing to check once HXE is up, and if it
turns out false the plan above collapses and we are back to parsing.
- **How the call reaches it from transpiled ABAP.** Today the runner is a
  command. Making a transpiled `CALL METHOD` land in HANA is the next seam.
- **What the real framework generates.** SAP's AMDP framework turns a method
  into a HANA procedure with a naming and a wrapper of its own, and ours is
  currently a guess informed by the method signature. Reading a generated
  procedure out of A4H's catalogue is the way to check our shape against the
  original, and it is read-only.

## Seamless AMDP: where the seam actually is

Measured 2026-09-18 by handing an AMDP class to the transpiler directly. Two
obstacles, one trivial and one that decides the design.

**`IF_AMDP_MARKER_HDB` does not exist in our tree**, so the class fails at
`implement_methods, Implemented interface "IF_AMDP_MARKER_HDB" not found`.
The interface is empty on a real system too — the compiler reads the marker,
not its content — so this is a file to add, nothing more.

**Then the real one: `Statement NativeSQL not supported`.** The transpiler
refuses to emit anything for the body of a method declared `BY DATABASE
PROCEDURE`. It is a hard stop, not a warning, and it is where seamless AMDP
has to be solved.

Two ways, and they are not exclusive:

**A. Upstream.** Teach the transpiler to emit a call rather than refuse — a
handler for `NativeSQL` inside an AMDP method that produces something like
`await abap.amdp.call(class, method, params)`. This is a real feature and
AMDP is currently a hard stop, so it may well be welcome; it is also
somebody else's release cycle.

**B. Here, by rewriting the input.** Before transpiling, replace the body of
each AMDP method with an ABAP call into a runner class of ours, and keep the
SQLScript aside to be deployed at boot. The ABAP *source* is untouched and
still compiles on a real system as the AMDP it is; only the copy that goes to
the transpiler is rewritten. That is exactly what `tools/cds2ddic.mjs`,
`tools/stg-compile.mjs` and `tools/segw-gen.mjs` already do — generate into
`gen/` from what `src/` declares — so it fits the tree rather than bending it.

B is the one to build: it needs nothing from anybody else, it can be finished
in this tree, and if A ever lands upstream the rewrite simply stops being
necessary. The scissors (`tools/amdp-extract.mjs`) already produce everything
B needs — the body, the signature and the HANA types.

**B's seam is proven, 2026-09-18.** The rewritten body is an ordinary routed
call, and the transpiler emits for it exactly what the existing RFC machinery
already consumes. Rewriting

```abap
METHOD calculate_squares.
  CALL FUNCTION 'Z_AMDP_PROBE' DESTINATION 'AMDP'
    EXPORTING  iv_count  = iv_count
    IMPORTING  et_result = et_result.
ENDMETHOD.
```

produces

```js
await abap.statements.callFunction({name: 'Z_AMDP_PROBE', destination: 'AMDP',
  exporting: {iv_count: iv_count}, importing: {et_result: et_result}});
```

and the runtime hands that to `abap.context.RFCDestinations["AMDP"].call(name,
signature)` — the same contract `tools/rfc-replay.mjs` already implements for
captured RFC. So the AMDP destination is a client of a dozen lines around the
runner that already works, not a new mechanism.

Two details that had to be checked rather than assumed, and both hold:

- **A function module can carry a class-local type.** `ET_RESULT` declared as
  `ZCL_VSP_00_AMDP_TEST=>TT_RESULT` in the `*.fugr.xml` parses, and the
  transpiler builds the right table structure for it. Without this the
  generator would have had to invent global DDIC types for every AMDP
  signature.
- **`IF_AMDP_MARKER_HDB` has to exist** or the class does not parse at all.

What B still has to decide: when the procedure is deployed (at boot, or on
first call with the source hash as the key), and what happens in the modes
where there is no HANA at all — refusing the call with a clear message is the
honest answer, since an AMDP body cannot run anywhere else.

## CDS table functions, implemented by an AMDP method

Alice, 2026-09-18. A table function is the other half of AMDP and the more
useful one, because its result is **queryable like a view** rather than
returned to one caller:

```
define table function ZTF_STG_PROBE
  with parameters p_client : abap.clnt, p_min : abap.int4
  returns { client : abap.clnt; travel_id : abap.char(8); seats : abap.int4; }
  implemented by method zcl_stg_tf_probe=>get_travels;
```

and the method is `BY DATABASE FUNCTION FOR HDB ... RETURNS VALUE(rt) TYPE
<table type>`. On HANA this is `CREATE FUNCTION ... RETURNS TABLE(...)`, not a
procedure.

**abaplint parses it, checked 2026-09-18.** The tree carries
`CDSDefineTableFunction` with the name, a `CDSWithParameters` node holding
each parameter's `CDSName` and `CDSType` (`abap.clnt`, `abap.int4`), and then
the `returns` list as the same `CDSName` / `CDSType` pairs. The
`implemented by method zcl_x=>meth` clause has no node of its own but is
plainly in the token stream. So nothing has to be parsed by hand except that
one fixed clause.

**Where the types come from, which is the question worth being precise
about.** There are three descriptions of the same row and they must agree:

1. the CDS `returns` list, in DDIC types (`abap.char(8)`) — **this is the
   authority**, because it is what a client of the view sees;
2. the ABAP table type the method returns, which is what the transpiled ABAP
   binds to;
3. the HANA `RETURNS TABLE(...)` of the generated function, which is what the
   SQLScript body actually fills.

The generator derives (3) from (1) with the same map the procedure path uses
(`abap.clnt` → `NVARCHAR(3)`, `abap.int4` → `INTEGER`, `abap.char(n)` →
`NVARCHAR(n)`), and **checks (2) against (1) field by field, refusing loudly
on a mismatch**. A silent mismatch here is the worst possible outcome: the
body would fill columns by position and the rows would come out plausible and
wrong.

What makes this worth building after the procedure path rather than before:
a table function has to be **registered as a readable source** so the SADL
runtime and the OData layer can select from it, which is the
`zif_stg_cds_source` shape that `tools/cds2ddic.mjs` already generates for
views and tables. The read is then `SELECT ... FROM "ZTF_X"(p_client => ?,
p_min => ?)`, which is a view with arguments and nothing more exotic.

## Converting HANA's values back into ABAP types

Alice, 2026-09-18, calling it the advanced wave — and it is, but most of it is
already solved in this tree and should not be written again.

`tools/rfc-replay.mjs` exports `fromJson(target, json)`, which exists for the
same problem one door along: a captured RFC result is plain JSON and has to
land in the runtime's **typed** values. It walks a table (clear, clone the row
type, append), matches a structure's fields ignoring case, and ends at
`target.set(json)` — which is where the ABAP type converts, pads and rounds by
itself. The AMDP destination receives the same shape (`{exporting, importing,
tables, changing}` with typed values), so it reuses this rather than
converting by hand.

That matters because converting by hand is where the mistakes live. ABAP
`CHAR(8)` is blank-padded and HANA's `NVARCHAR(8)` is not — measured earlier
in this document — so a `travel_id` of `'T1'` has to become `'T1      '`, and
`set()` on the target does it without anyone deciding to.

What `fromJson` does not cover and the AMDP client has to do first:

- **`NCLOB` and `BLOB` arrive as Buffers**, so they are decoded before being
  handed over; `tools/amdp-run.mjs` already has `readable()` for this.
- **`DATE` and `TIME`** come back as driver objects, while ABAP holds them as
  `CHAR(8)` and `CHAR(6)` text — `20260918`, `143005`. Not yet measured
  against HXE; do that before writing the conversion.
- **NULL.** ABAP has no null, and `fromJson` returns early on one, leaving the
  target at its initial value. That is the right answer and it is worth
  knowing it is deliberate rather than an oversight.

**Measured, 2026-09-18**: node-hdb hands HANA's `DATE`, `TIME`, `TIMESTAMP`
and `SECONDDATE` over as **strings**, not `Date` objects —

```
D   DATE         "2026-09-18"
T   TIME         "14:30:05"
TS  TIMESTAMP    "2026-09-18T14:30:05.123"
SD  SECONDDATE   "2026-09-18T14:30:05"
```

so `abapDateTime()` in `tools/amdp-destination.mjs` takes the separators out:
`20260918`, `143005`, `20260918143005`. Without it `set()` on an ABAP `D`
would store `2026-09-` into eight characters and be quietly wrong, which is
the failure this whole file keeps meeting.

**Our own tables never reach that path.** The transpiler writes ABAP `D` and
`T` into the schema as `NCHAR(8)` and `NCHAR(6)`, so they come back as
`"20260918"` and `"143005"` already — verified in the same probe. The
conversion is for an AMDP body that returns a real HANA date, `SELECT
CURRENT_DATE` being the obvious one.

The test checks what is left alone as carefully as what is converted: a
converter that also touches `"square of 3"` or an eight-digit string that was
already a date is how a value ends up wrong.
