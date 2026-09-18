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
