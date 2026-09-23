# gogen: a Go backend for transpiled ABAP (spike)

A measurement, not a product. The question was whether a second backend for
the abaplint transpiler, one that emits Go instead of JavaScript, is worth
building. The rationale is the research page "Куда транспилировать ABAP".
This folder answers it on a small, controlled subset.

```
node tools/gogen/run.mjs            # ABAP -> IR -> Go, and the same ABAP through the JS transpiler
```

Needs Node (`node_modules` of the checkout, for `@abaplint/core` and
`@abaplint/transpiler`) and Go >= 1.26. Nothing is written outside this
folder: `.out/` and `go/cmd/bench/zz_generated.go` are generated and ignored.

## Shape

```
samples/*.clas.abap
  -> @abaplint/core (parse, syntax, scopes)          reused, not rewritten
  -> transpiler's Rearranger (operator precedence)   reused, not rewritten
  -> frontend.mjs: IR                                typed, calculation type decided, conversions explicit
  -> emit-go.mjs: Go                                 spells the IR, decides nothing
  -> go/abap: runtime                                ABAP semantics where Go's differ
```

The IR is the part that matters for the real thing. The calculation type of
every arithmetic expression is fixed in the front end, and it **includes the
target**. That is the rule ANORMALIES measured on A4H: `lv_f = lv_i / 2` is
1.5 and the `i` version is 2. So a backend never tests a type at run time.
Values are plain Go values: `int32` for `i`, `float64` for `f`, a slice for a
standard table. A method is a function taking the `Session` first. The
Session is the roll area and carries `sy`, so any goroutine can run any
session.

Subset, grown until two demo scenes compile unchanged: `i`, `f`, `int8`,
`string`, `c`, `x`; structures and standard tables of anything in the
subset; instance and static classes, attributes, constructors with DEFAULT
parameters, interface methods and constants; `DATA( )` inline, `CONV`,
`VALUE` (nested `VALUE #( )` too), string templates and `&&`; `IF`, `CASE`,
`DO`, `WHILE`, `LOOP AT ... INTO`, `APPEND`, `READ TABLE ... INDEX`,
`TRANSLATE`, `EXIT`, `CONTINUE`, `RETURN`, `CLEAR`; method calls with
positional, named and EXPORTING/IMPORTING parameters; `sin cos tan sqrt exp
log abs sign floor ceil trunc frac nmax nmin lines strlen`;
`sy-index sy-tabix sy-subrc`. Anything else is `Unsupported` with its name,
and a method that calls a refused one is refused in turn. Refused on
purpose until measured: `i` -> `string` (the sign goes to the end there),
and arithmetic whose calculation type would be `p`.

## Measured, 2026-09-23

16-core x86-64 workstation (WSL2), Node 26.9, Go 1.26.0,
`@abaplint/transpiler` 2.13.89 from npm (without the plain-arithmetic flag of
the `transpiler-codegen` fork).

| work (median) | Go | JS | JS / Go | same answer |
| --- | ---: | ---: | ---: | --- |
| plasma frame, 320×200, sin/cos/sqrt per pixel | 1.66 ms | 23–25 ms | 14–15× | yes |
| fib(25), recursive static calls | 0.24 ms | 22–25 ms | 95–105× | yes |
| primes to 50 000, nested WHILE with MOD | 1.6 ms | 91 ms | 55× | yes |
| 1 000 000-row table: APPEND, LOOP, READ INDEX | 8.6–10.7 ms | 330–370 ms | 35× | yes |

Plasma frames per second, one Session per goroutine, nothing shared:

| JS, one thread | Go ×1 | ×2 | ×4 | ×8 | ×16 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 40 | 588 | 1027 | 1661 | 2350 | 2798 |

Build and size: front end + emit 150–190 ms, `go build` 0.16–0.74 s (warm
or cold cache), binary 2.0 MB stripped, of which almost all is the Go
runtime. The generated Go is 4.9 KB; the transpiled JS is 14.2 KB.

Where the time goes, in order of the ratios. A call is the costliest thing
in the JS output: every method is `async`, and every call is an `await` with
boxed arguments (fib, 95–105×). A table row is an object (35×). Arithmetic
through the operator protocol costs 15–55×. Plasma is the smallest gap
because `Math.sin` is the same cost in both.

## Language or model? The same IR emitted as JS

`emit-js.mjs` writes JavaScript from the same IR, with the same value model
as the Go backend: numbers instead of boxed ABAP values, synchronous calls
instead of an `await` on every one, the calculation type decided at compile
time, structures as objects copied on a move. The runtime (`js/abap.mjs`)
follows `go/abap` line for line. It answers the same as Go on all 21
semantic cases and on every frame of both scenes.

| work | transpiler JS | JS from the IR | Go | transpiler / IR | IR / Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| plasma kernel (sample) | 25.5 ms | 3.6 ms | 2.1 ms | ×7 | ×1.7 |
| fib(25) | 24.0 ms | 0.96 ms | 0.24 ms | ×25 | ×4.1 |
| primes to 50 000 | 93 ms | 3.4 ms | 1.6 ms | ×27 | ×2.1 |
| table of 10⁶ rows | 311 ms | 11.3 ms | 8.7 ms | ×28 | ×1.3 |
| scene glitch, a frame | 205 µs | 16.4 µs | 14.2 µs | ×12.5 | ×1.15 |
| scene plasma, a frame | 2527 µs | 218 µs | 117 µs | ×11.6 | ×1.9 |

So most of the gap is the model, not the language: the same IR in JS is
7-28 times faster than today's transpiler output, in the browser too. Go
adds 1.2-4 times on top, most on calls (fib), and every core of the
machine on one session's work.

## Demo scenes against A4H

`node tools/gogen/scenes.mjs <scene>` compiles one scene of ZO4D straight out
of `packs/o4d/upstream` (the interface and the class, nothing rewritten),
gives its `render_frame` the context of every frame of the A4H recording
(`t`, `gt`, and `pos_16` computed like `ZCL_O4D_APC_HANDLER=>CALC_BEAT_INFO`),
and compares lines, rects and texts number by number with the recording.

| scene | frames equal to A4H, Go | frames equal to A4H, JS (npm 2.13.89) | Go a frame | JS a frame | JS / Go |
| --- | ---: | ---: | ---: | ---: | ---: |
| glitch | 64 of 64 | spot-checked equal | 14 µs | 205 µs | ×14.5 |
| plasma | **256 of 256** | 249 of 256 | 140 µs | 2527 µs | ×18 |

The seven plasma frames the JS runtime gets wrong (10, 41, 161, 177, 192,
208, 223) are exactly ANOMALY-2026-09-17-integer-division-not-rounded: a
`/` inside an integer expression keeps its fraction there. The Go backend
rounds it, because the IR computes the calculation type of the whole
expression, target included, which is what A4H does.

The f format of a string template was measured on A4H before it was
written (fifteen values, `go/abap/fmtf_test.go`): seventeen significant
digits, always positional, trailing zeros dropped.

### The whole demo, 2026-09-23

`node tools/gogen/demo.mjs [scene ...]` compiles all of ZO4D (83 classes:
the APC handler, the demo director, every effect) into one Go binary and one
JS module, and plays every A4H recording through the handler's own path
(`BUILD_RENDER_CTX`, `GET_EFFECT_AT_BAR`, `RENDER_FRAME`, `FRAME_TO_JSON`).
Each scene runs in a process of its own under a 4 GB / 120 s ceiling, since
a loop the compiler gets wrong grows a table without end (one did, and took
the WSL machine with it).

| | frames equal to A4H | scenes equal frame for frame |
| --- | ---: | ---: |
| Go with sin/cos from glibc (`demo.mjs --libm`) | 3840 of 3840 | 25 of 25 |
| Go, pure (fdlibm port, the default) | 3422 of 3840 | 17 of 25 |
| JS from the same IR (V8's sin/cos) | 3422 of 3840 | 17 of 25 |

Pure Go and JS agree with each other everywhere; where they differ from
A4H it is the last bit of `sin` (a known difference). The triangle order
of amiga_ball, amiga_ball_2 and sierpinski used to differ as well: `SORT
... BY z` without `STABLE` leaves equal keys in the kernel's order
(`[3,2,1,0] [6,7,5,4] ...`). The demo now carries a second key
(vivid-vibes#5, activated in `$ZO4D` and re-recorded on A4H).

What it took, each measured before it was written:
- attribute `VALUE`s set when the object is made (a `mv_scale` left at 0
  stepped a `WHILE` by 0);
- `x IS NOT INITIAL` read its `NOT` twice;
- `DATA(x) = frac( f )` is an f: abaplint types the six numeric built-ins by
  a fixed return (#4302), the IR types the declaration from its source;
- **sin and cos are glibc's on A4H.** The Go build calls glibc only when asked (`node demo.mjs --libm`, cgo); by default it is the pure-Go fdlibm port, the same on every platform, and the difference is known (ANORMALIES sin-cos-libm). The seed chains of constellation and
  ignition (`seed = frac( sin( seed * 12345 + i ) * 43758 )`) diverge from
  V8 at exactly the step where glibc and fdlibm differ, and a build that
  calls glibc through cgo reproduces them frame for frame. Go's own
  `math.Sin` differs from both in the last bit for 43 % of arguments; the
  pure-Go default is a port of fdlibm, bit-equal to V8 on 194 621
  arguments. A pure port of glibc's sin would give JS and cgo-free Go the
  same answer as A4H.
- x fields: `i MOD 256` into x LENGTH 1, `BIT-XOR`, x -> i unsigned, all
  measured on A4H.

Speed, 2026-09-23, each runtime alone on one machine with the same tool
(`tools/o4d-profile.mjs`: the median of 60 frames a scene over the demo's
own WebSocket channel, full frame with `FRAME_TO_JSON`, 26 scenes; the
stands are `o4dserve.mjs` / `o4dserve-js.mjs` in front of an OSG server):
JS from the IR is x2.9 the transpiler runtime (faster on every scene,
x1.2-x8.8), Go x5.8 (x1.5-x29) and x1.9 the IR's JS. A first comparison
against `demo.mjs`'s in-process averages said x1.5 and "slower on four
scenes"; that was two instruments, not two runtimes. Go was ten times
slower than JS on the JSON-heavy scenes until a loop that only appends to
a local string got a `strings.Builder`. Peak memory of a whole recording
(harness keeps every frame): Go 10-430 MB, JS 60-1330 MB.

## Semantics: what the two backends answer

Every row below was measured on A4H with ABAP Unit (2026-09-23).
| case | ABAP rule | Go | JS |
| --- | --- | --- | --- |
| `7 / 2`, `-7 / 2`, `5 / 3`, `-5 / 3` (i) | 4, −4, 2, −2 | same | same |
| `0 / 0`, `1 / 0` | 0, CX_SY_ZERODIVIDE | same | same |
| `7 DIV -2`, `7 MOD -3` | −3, 1 | same | **−4, 2** |
| `-7 DIV -2` | 4 | 4 | **3** |
| `MOD` with negative operands | never negative | same | same |
| f 2.5 / −2.5 / 1.4999 → i | 3 / −3 / 1 | same | same |
| f 3e9 → i | CX_SY_CONVERSION_OVERFLOW | same | **3000000000** |
| i 3 / i 2 into f | 1.5 | 1.5 | 1.5 |

The JS disagreements are recorded in ANORMALIES. DIV and MOD with a
negative divisor are fixed upstream in abaplint/transpiler#1885; f -> i
without an overflow is a question for Lars, not a patch.

## One request of OSG's gateway, 2026-09-23

`node tools/gogen/gateway.mjs` compiles OSG with its libraries (821
classes, open-abap-core, open-abap-odata and the rest), registers the SEGW
services and sends `GET /sap/opu/odata/sap/ZSTG_DEMO_SRV/?$format=json`
through `ZCL_STG_DISPATCHER`. The Go binary answers what OSG answers:

```
200 OK
application/json
{"d":{"EntitySets":["TravelSet","BookingSet","StatusVHSet","PhotoSet"]}}
```

On the way: the SEGW registry, the URL parser (FIND REGEX), the model
registry (`CREATE OBJECT ... TYPE (name)`), the `_MPC_EXT` -> `_MPC` ->
`/IWBEP/CL_MGW_PUSH_ABS_MODEL` chain (inheritance, `SUPER->`, the
constructor chain), the model's `DEFINE` with its entity types, properties,
annotations and actions, and `BIND_STRUCTURE` through RTTI. What that took,
each measured on A4H where the rule could be argued and pinned in
`semantics.mjs`:

- `CREATE OBJECT` static and by name, through a class registry; the name is
  taken as written (lower case is CX_SY_CREATE_OBJECT_ERROR).
- Single inheritance: the superclass embedded, one Go interface per class
  that has subclasses, `self` for the calls a method makes on `me`, `SUPER->`
  bound statically, `?=` / `CAST` checked, an initial reference widened stays
  initial. In a superclass's constructor, `me->m( )` is the superclass's own.
- Classic exceptions: `RAISE name`, `EXCEPTIONS ... = n` / `OTHERS`,
  `RECEIVING`.
- `RETURN`, `EXIT`, `CONTINUE` out of a `TRY` (a closure in Go, so they come
  out as codes); `ASSERT`; structured constants; aliases; interfaces that
  include interfaces; `csequence` / `clike` parameters; call chains.
- Two kernel services in the host, since open-abap-core writes them as
  `WRITE '@KERNEL ...'` JavaScript: `describe_by_name` for structures (from
  a table the compiler builds out of the registry: the dictionary's
  structures and the classes' `TYPES`) and `unescape_url`. Every other
  `@KERNEL` line is a stub that dumps: it was a silent no-op before, which
  ran the ABAP around it on values nobody set.

The call closure from `ZCL_STG_DISPATCHER=>DISPATCH` (`closure.mjs`), as
of 2026-09-23 after class-based exceptions: 116 methods reachable, 114
compiled with 30 statement stubs inside them, 2 whole methods stubbed
(`/IWBEP/CX_MGW_BASE_EXCEPTION=>IF_MESSAGE~GET_TEXT`,
`/IWBEP/CL_MGW_PUSH_ABS_MODEL=>DEFINE`). What is left: `SPLIT` into several
targets (6), `COMMIT` / `ROLLBACK`, `CONDENSE`, `SHIFT`, `d` and `t`
conversions and offsets, a numeric `MSGNO` type. (It was 53 / 47 / 43 / 6
when the service document first answered, with `REF TO data` and `RAISE
EXCEPTION TYPE` among the gaps.)

## Database writes and the LUW, 2026-09-23

`COMMIT WORK [AND WAIT]` and `ROLLBACK WORK` compile: `go/abap/luw.go` keeps
one database transaction per dialog step, and a host runs a step through
`abap.DialogStep`, which commits when the work returns and rolls back when
it dumps (the rule of `tools/osd-dialog-step.mjs`, the kernel's and not the
application's). sy-subrc 0 and sy-dbcnt untouched, measured on A4H. The JS
emitter has no database and refuses both. 3313 -> 3306 statement stubs in
the gateway, 65 -> 62 in the closure of `DISPATCH`.

With a database open and no step running, every statement autocommits, so
`ROLLBACK WORK` there is refused (`NOT_COMPILED`) rather than answered 0
as if it had undone something; `COMMIT WORK` there is a no-op. A step
begun inside a step fails at once (the pool has one connection, so the
second `Begin` would otherwise wait forever), and a rollback that fails
after a dump does not replace the dump. `DELETE <name> FROM ...` goes to
the database only when `<name>` is not a variable: an internal table named
like a TABL is the internal table's, as on A4H (`ZCL_GOGEN_T_DELNAME`).

`INSERT` / `UPDATE` / `MODIFY` / `DELETE` on a table compile through the
write nodes of the shared relational IR (`tools/ir-writes.mjs`, 2026-09-23).
`UPDATE ... SET ... WHERE` and `DELETE FROM ... WHERE` are lowered at build
time by `lower()`; a write whose rows are a work area or an internal table is
built with ir-writes' constructors, lowered once to refuse what the IR
refuses, and its rows are rendered at run time by `go/abap/irsql.go`, a port
of the SQLite rendering checked byte for byte against
`test/fixtures/ir-pairs/writes.json` (14 of 14). sy-subrc and sy-dbcnt are
A4H's (`ZCL_GOGEN_T_DBW` in `semantics.mjs`): a duplicate key of a work
area is 4/0, `INSERT FROM TABLE` writes every other row and raises
`CX_SY_OPEN_SQL_DB` with sy untouched, `ACCEPTING DUPLICATE KEYS` is 4 and
the rows written, `UPDATE` / `DELETE FROM` a work area or a table go by the
primary key one row at a time with the counts summed, MANDT is the logon
client whatever the work area holds, and a field the work area does not set
is its initial value, never NULL. Four of those rules the transpiler's
runtime gets wrong (ANORMALIES `dbwrite-*`). A column of kind p, f, x or
xstring is not written yet (a stub). The JS emitter has no database and
refuses each such statement.

`col IN range` is `rangesPredicate` of `tools/ir-ranges.mjs`: the build
lowers the statement with a `/*@range:<id>*/` marker where the range goes,
and `go/abap/ranges.go`, a port checked against `ranges.json` (44 of 44:
33 renderings byte for byte, 11 outcomes), fills it at run time. Replayed
on SQLite against A4H's own measurement (`a4h-ranges.json`, 80 cases): 65
select A4H's rows, 7 raise what A4H raised (an uncatchable
`SAPSQL_IN_ITAB_ILLEGAL_*` dump, a catchable `CX_SY_OPEN_SQL_DATA_ERROR` /
`CX_SY_DYNAMIC_OSQL_SEMANTICS`), 8 are refused by name (`NOT_COMPILED`).
The Go host keeps the store as HANA does: `PRAGMA case_sensitive_like` on,
CHAR columns right-trimmed after the seed (`go/abap/dbstore.go`). `SELECT
COUNT(*)` compiles; sy-dbcnt is the count, sy-subrc 4 when it is 0; `SELECT
... INTO TABLE` sets sy-dbcnt to the rows and `SELECT SINGLE` to 1 or 0
(A4H, `ZCL_GOGEN_T_SELCNT`). A WHERE takes comparisons, `IN` a range, `AND`,
`OR`, `NOT` and parentheses. `IN` on a `d` column is refused at build time
(ir-ranges does not carry dates). A string, or a c longer than its CHAR
column, compared in a WHERE or written by `SET` is bound right-trimmed when
it fits and refused (`NOT_COMPILED`, `abap.DBCFit`) when it does not,
never cut to the column: A4H raises `CX_SY_OPEN_SQL_DATA_ERROR` for such a
range LOW, and the plain comparison and the `SET` are not measured yet
(`ZCL_GOGEN_T_HOSTFIT`, `ZCL_GOGEN_T_HOSTLONG`).

## What this does not show

- **Known gap, call emission:** a method call without `EXCEPTIONS` leaves
  sy-subrc as it was in both emitters; on A4H it is 0 afterwards
  (`ZCL_GOGEN_T_CALLSUBRC`, pinned to the wrong `call:4`). It is why
  `ZCL_GOGEN_T_DBW` answers `tabcx:4` where A4H answered `tabcx:0`. For
  whoever owns call emission, not the database.

- The database is Go-only: `SELECT ... INTO TABLE` and `SELECT SINGLE`
  (lowered through the relational IR of portable AMDP, run on SQLite in the
  Go host, the logon client added to the WHERE) exist in the Go backend; the
  JS backend refuses both at run time. `SELECT SINGLE` without
  `CORRESPONDING FIELDS` is refused unless each column has its field's type
  and length (a move by layout); a character field takes its column cut to
  its length. `COMMIT WORK` / `ROLLBACK WORK` close the dialog step's
  database transaction. `INSERT` / `UPDATE` / `MODIFY` / `DELETE` on a
  table compile (above); every other SQL form (`FOR ALL ENTRIES`, `JOIN`,
  `GROUP BY`, dynamic clauses, `IS NULL` / `IS INITIAL`) is a
  `NotCompiled` stub.
- `d`, `t` and `n` are declared, copied and compared with initial; `p` is
  declared and copied only; no `decfloat`. No `RAISE RESUMABLE`, no `RAISE
  EXCEPTION ... MESSAGE`, no T100 or OTR texts in `get_text( )`.
- Class statics are per process, so a host runs one step at a time (the
  stand serializes). Statics per session come before any parallelism.
- The handler's `ON_MESSAGE` is still three host lines in the stands; the
  `RETURN` inside its `TRY` that kept it out compiles now.
- Table values: an assignment, `APPEND`, `MODIFY`, `READ ... INTO`, `LOOP
  ... INTO` clone a table or a structure holding one; a composite
  `IMPORTING` by reference is a pointer in Go and the object in JS, a
  `VALUE( )` one is a copy (measured on A4H, pinned by `semantics.mjs`).
  Secondary keys, `SORTED` tables and `READ ... WITH KEY` are not there.

## Class-based exceptions, 2026-09-23

`RAISE EXCEPTION TYPE cls [EXPORTING ...]` and `RAISE EXCEPTION obj` of
any class compiled in the program, `CATCH` by the class hierarchy,
`CATCH ... INTO` with the object's attributes readable, `get_text( )`,
`previous`, and `CLEANUP`. The object travels in the panic (Go:
`*abap.Raised{Obj, Class}`, JS: `abap.Raised`) beside the runtime's own
exceptions (`abap.ArithmeticError` / `abap.AbapError`), which are
unchanged. A `CATCH` of runtime exceptions is still decided by the front
end; one of raised objects walks a table of superclasses at run time
(`abap.RegisterSupers`), since `RAISE EXCEPTION obj` only knows its class
then, and an ancestor outside the program (cx_static_check in a test)
still counts. `INTO` a variable of a `CATCH` that takes only raised objects
receives the object itself; `INTO` one that also takes runtime exceptions
(`CATCH cx_root INTO`) stays an exception value whose one method is
`get_text( )`, the object's own when it was raised.

Measured on A4H and pinned (ZCL_GOGEN_T_RAISE): hierarchy, first fitting
`CATCH`, `CLEANUP` inner then outer then the handler, no `CLEANUP` for an
exception raised inside a `CATCH` of the same `TRY`, a runtime exception
passing a `CLEANUP`, `get_text( )` of a class without a text is `An
exception was raised.` (open-abap's fallback, the same text, served by a
host function; a T100 or OTR text dumps), `RAISE EXCEPTION obj` hands over
the same object. Refused, as a system refuses: a `CATCH` after one of its
superclass (does not activate on A4H; abaplint takes it, ANORMALIES
catch-after-superclass). An initial reference raised aborts, and nothing
catches it. An exception that no `TRY` takes runs no `CLEANUP` at all:
the kernel looks for a handler before it unwinds and dumps at the `RAISE`
(A4H 2026-09-23: the same code in an RFC module, each `CLEANUP` writing a
committed row, `UNCAUGHT_EXCEPTION` at the `RAISE` and no row; the rows of
a handled one did come). Each `TRY` with `CATCH`es registers them in the
session while its body runs (Go `Session.Handlers`, JS `s.handlers`), and a
`CLEANUP` runs only when one further out takes the exception; pinned by
ZCL_GOGEN_T_UNCAUGHT and its reader, and the Go dump names the `RAISE`'s
line, the stack a `TRY` passes on starting at the frame that raised.

`GET /sap/opu/odata/sap/ZSTG_DEMO_SRV/NoSuchSet` through the Go binary:
`404 Not Found`, and the body (132 bytes) byte for byte what OSG answers.
Headers are not compared: the Go host prints the dispatcher's status,
reason, content type and body, and OSG's HTTP layer adds
`dataserviceversion: 2.0` and `; charset=utf-8` on top:
`{"error":{"code":"STG/ENTITY_SET_NOT_FOUND","message":{"lang":"en","value":"Entity set NoSuchSet does not exist in ZSTG_DEMO_SRV"}}}`.

## OSGo host, 2026-09-23

`node tools/gogen/osgo.mjs` (heavy: all 822 classes, run it under the
shared lock) builds `.out/osgo`, an HTTP server in front of OSG's own ICF
handler; `node tools/gogen/osgo.mjs --echo` builds `.out/osgo-echo` over
the shim, open-abap-core and a test handler at `/echo` in five seconds.

```
.out/osgo [-port 3095] [-addr 127.0.0.1] [-db file.sqlite] [-root <checkout>]
```

The request path is the one the Node hosts run: express-icf-shim's
`CL_EXPRESS_ICF_SHIM=>RUN`, **compiled as it is**, builds the ICF server,
request and response objects and calls the handler class. Only its eleven
`WRITE '@KERNEL ...'` lines are host functions (`go/abap/icf.go`, listed
line by line in `frontend.mjs` `KERNEL`; the `for (const h in
req.headers)` loop is a `kernel_loop`), and they answer what express
answers: lower-case header names (repeats joined as Node joins them; sorted,
since Go does not keep the order), the raw URL and path, a body only with a
content type (express.raw, 16 MB), `res.append` and `res.send` with the
charset express adds to a text or JSON content type, no body for HEAD, 204
and 304. What that took in the front end: the shim's local server class
compiles (local classes, for the owners in `LOCAL_CLASSES` only), a class
with local classes reads its own scope and not the first one (it read the
local's: `mi_server` "was not an attribute"), `DEFAULT <constant>` resolves
to the constant's value, and `CL_HTTP_ENTITY`'s `get_cdata` / `set_cdata`
are host functions with arguments, because `CL_ABAP_CONV_IN_CE` takes
generic parameters: UTF-8 both ways, bytes that are not UTF-8 raise
`CX_SY_CONVERSION_CODEPAGE`, as open-abap-core's fatal TextDecoder does.

Each ICF request is one dialog step (`abap.DialogStep`) with a fresh
Session, one at a time (statics are per process); a dump is the Node host's
500 (`STG/RUNTIME` JSON with the ABAP frames for OData, `<class>: <text>`
for a SICF node), and rolled back. Mounted: `/sap/opu/odata/sap/` with
`ZCL_STG_HTTP_HANDLER`, every SICF node of the tree whose handler class is
compiled (10), `/app` (the tree's `webapp/`, express.static's redirects,
ETag and 304), each pack's `/app/<name>`, `/app/packs.json`,
`/appconfig/fioriSandboxConfig.json`, `/` to the launchpad, and
finalhandler's 404 for the rest. A SICF node whose class is not in this
program (four: `webgui/sapevent`, and `zork`, `zo4d_demo`, `lsd` from the
packs) is mounted too, as a refusal: `501 <path>: <CLASS> is not in this
program`. Without it a request below such a node fell to its parent, and
`webgui/sapevent` ran as a menu request of `ZCL_OSD_WEBGUI`. What express
refuses of a response is a host error (`abap.HostError`, not catchable, not
`NOT_COMPILED`): a second send ("headers already sent") and a second
`Content-Type` (`res.set` of an array). The database is in memory, or `-db`
an SQLite file in WAL mode, seeded once when it has no tables and marked
with a hash of the build's tables and seed rows (`PRAGMA user_version`); a
file another build seeded, or nobody marked, is refused at start rather than
used. `ZOSD_STATUS_SRV` and the webgui read the five status tables, which
the Node hosts refresh before each such request (`withFreshStatus`); OSGo
has no refresh yet, so they answer out of the seed with
`X-Osgo-Status-Snapshot: seed; not refreshed`.

The front-end changes this needed that are not ICF-specific (findScope by
class name, `DEFAULT <constant>`, the flattened block list,
`CX_SY_CONVERSION_CODEPAGE`) are their own commit, ahead of the host
commits, so that another branch touching `frontend.mjs` can rebase onto it.

Against OSG on :3091 (bodies with the same `Host`): the service document,
`TravelSet('T0001')`, `NoSuchSet` (404) and `/` without `$format` are byte
for byte equal; `TravelSet` is equal except T0009, the client-001 row OSG
serves ("Other client, must not leak") and Go filters. The launchpad
(`/` -> `/app/flp.html`) renders its 35 tiles in Chromium and asks this
origin for nine things: seven are answered as OSG answers them, two are
500 where OSG answers 200 -- `/sap/bc/osd/amdp/engine` (a statement stub in
`ZCL_OSD_AMDP_SBX`: `sy` as a whole) and `ZVDB_100_SRV/VectorSet/$count`
(a pack's service, its DPC is not in this program). Opening an app stops
at `$metadata` (a stub in `ZCL_STG_DISPATCHER=>RUN`: `handle( ... )-data`);
the BSP pages stop at a `SELECT` form in `ZCL_OSD_BSP`, the webgui at
`SELECT ... ENDSELECT`, the RFC catalogue at `GET_TYPE_ID`'s kernel line.
Those are the compiler's next steps, not the host's.
## SMW0 media and APC for a Go host, 2026-09-23

Two host services a server built from this compiler mounts.

**SMW0.** `CALL FUNCTION '<literal>'` of a module the host implements
(`NATIVE_FM` in the front end) compiles into a Go call that takes every
actual as generic data and raises the module's classic exceptions by name;
the JS emitter refuses it. `go/abap/w3mi.go` answers `WWWDATA_IMPORT` and
`SCMS_BINARY_TO_XSTRING` out of a media directory beside the binary
(`abap.SetMediaDir`, a flag of the host): `node media.mjs --out <dir>
<folder> ...` copies every W3MI object's data file there with an index
`w3mi.json` (object id, as the object's XML names it, to file and size),
and `media.mjs` also gives the `WWWPARAMS` rows with the real filesize
(`replaceWwwparams`: the transpiler's `DatabaseSetup` writes 0 for an
object whose data file it was not handed; `node --test media.test.mjs`
holds it against `PopulateTables`' own rows, and it throws rather than
duplicate when it recognises no row of an object). What a system answers at the
edges was measured on A4H first and is pinned (`ZCL_GOGEN_T_W3MI`,
ANORMALIES w3mi-edges: open-abap-core differs in three places).
`node mediacheck.mjs` reads the 31 objects of o4d and zork (11.9 MB, the
three MP3s and ZORK-MINI-Z3 among them) through compiled ABAP of the
packs' loader shape and compares them with the files: 31 of 31 equal, and
an unknown object sy-subrc 1, in 37 ms. The packs' own loaders stop before
the call, at `SELECT ... WHERE col = value INTO TABLE` (the o4d handler,
Zork's game loader) and `CONCATENATE ... IN BYTE MODE` (Zork), which the
subset does not have yet.

**APC.** `go/apc` is the socket part of the framework as an
`http.Handler` (`apc.Channel`) for `/sap/bc/apc/sap/<app>`, in a package of
its own so that a program without a push channel links no WebSocket
library; the dialog step (`abap.APCStep`, `abap.WorkProcess`) stays in
`go/abap`. The ABAP part stays ABAP, open-abap-apc's `ZCL_APC_HOST`
(handler by name, `open` = ON_ACCEPT + ON_START, `message`, `close`,
`drain`), which the Node hosts drive too. A program adapts it in a few
lines (`cmd/o4dserve` `apcHost`). A request that is not a WebSocket
handshake (426/400/405) or comes from another origin than the page's own
or `OriginPatterns` (403) is answered before any ABAP runs. One Session per
socket, each call one dialog step under `abap.WorkProcess` and
`DialogStep`, ON_START before the upgrade and its messages written after
it (open before drain), a rejection 403, binary frames refused with 1003,
a broken write closed as 1006. A host that serves HTTP from the same
process takes `abap.WorkProcess` for its own steps (or gives the channel a
`Step` holding its lock). The ZO4D stand runs on it with the handler's own
ON_MESSAGE (`-origins` for a page served from elsewhere); `cmd/apcprobe`
(length and sha256 of every message) finds it equal to the stand at
98d4d1c for the config, the scenario, 300 frames and the JSON and control
commands.

**What this is not yet.** The media host is proved through a stand-in of
the loaders' shape (`testdata-media/zcl_gogen_t_w3miload`), not through the
packs' own `ZCL_O4D_HTTP_HANDLER=>GET_*_FROM_SMW0` and
`ZCL_ORK_00_GAME_LOADER_SMW0`, which still stop at `SELECT ... WHERE` and
`CONCATENATE IN BYTE MODE`; no build calls `media.mjs` yet (the osgo build
is the host's), and there is no Go Zork APC stand. The tiles do not read
their media through Go today; once `SELECT ... WHERE` lands, `mediacheck`
is to be rerun against the packs' loader methods themselves.

## Next, if this is pursued

Ranked with codex gpt-6-sol, 2026-09-23:
1. ~~One request end to end~~ (done, above), and ~~the exceptions,
   interface dispatch and inheritance it needs~~ (done).
2. An entity set: `REF TO data`, `RAISE EXCEPTION TYPE`, then the database.
3. A step budget counted at loop back edges (a goroutine cannot be stopped
   from outside; the OOM of 2026-09-23 is the reason).
4. The DB layer through the shared relational IR and its conformance pairs.
5. Statics per session, after deciding which statics are session state and
   which are shared caches.
