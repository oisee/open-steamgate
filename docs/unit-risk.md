# ABAP Unit write warnings

`UnitRisk` in `tools/osd-unit-risk.mjs` builds a method call graph from the
abaplint registry. The façade's `/core/http/unit/object` exposes confirmed
`writes` (including a `path`) and separate `dynamicCalls`. The VS Code warning
shows a concrete test-to-write path with source positions and at most five
call hops; an ellipsis marks omitted middle hops. Counts describe distinct
reachable write statements, not hypothetical implementations.

The `/core/http/xref/readers` and `/closure` routes remain reverse dependency
queries for deciding which tests an edit affects. Their type-reference edges
are appropriate for that purpose, but are not executable calls.

## Reachability policy

Roots are the object's test methods, setup/teardown methods and constructors.
Only statements in reachable bodies contribute calls, constructions or writes.
Unused methods and `DATA ... TYPE REF TO` declarations add no call edges.
Static methods, local helper methods, literal function-module calls, inherited
methods and constructors are followed. Executable static component reads and
writes initialize the class and its entire superclass chain. Constant access
is included conservatively; type-only references such as `TYPE class=>type`
remain declarations. Instantiation also follows the parents' instance
constructors, preserving the concrete receiver through `super->constructor`.
Dynamic `ASSIGN` follows initialization only when its operand designates a
static component: `ASSIGN ('class=>attribute')`, `ASSIGN ('class')=>attribute`
and `ASSIGN (class)=>(attribute)`. Unknown class/component designations give
uncertainty without expanding to unrelated classes. A literal without `=>`
is local data, not class access. For `ASSIGN (name)`, a declared numeric,
date/time or one-character type cannot contain `=>` and stays quiet; longer
character names and unavailable types remain uncertain. Component names and
attributes reached through instance references are not static class names.

Type-only designations do not initialize the designated class: `TYPE REF TO`,
`CREATE DATA ... TYPE`/`LIKE`, `CASTING TYPE`, `ASSIGN LOCAL COPY OF INITIAL`,
`DESCRIBE` and RTTI `describe_by_name`/`describe_by_object_ref`. RTTI methods
remain ordinary executable calls: their bodies, constructions, and real
static accesses are still followed. There is no assertion-framework exemption.
Value operands such as `CREATE DATA ... LENGTH class=>attribute` still access
the static component and initialize its class.
Assertion methods are followed when
called; the test runner is not implicitly a root.

`CREATE OBJECT`, `NEW`, `RAISE EXCEPTION TYPE` (including RESUMABLE and
SHORTDUMP), expression `THROW` and constructions inside reachable factories contribute
concrete receiver classes. A worklist processes each (method body, concrete
receiver class) state once. Calls subscribe to an index of compatible receiver
types, so a factory visited after an interface call can still supply its
receiver without rescanning all reached bodies. Interface and
virtual calls dispatch only to compatible classes instantiated by reachable
code. A superclass call does not fan out to uninstantiated subclass
redefinitions. Instantiation is conservative across the reachable test set,
not an analysis of branch conditions or individual variable identities.
Inside an inherited body, `me->method( )` and unqualified `method( )` dispatch
on that state's concrete receiver, including its redefinitions. Inherited
method lookup and parsed body operations are cached; predecessor links avoid
copying an entire path on each hop of a long chain.

When a receiver cannot be established, the fallback is an unresolved-call
finding, never every implementation in the system. Non-literal dynamic method,
function and construction targets also produce uncertainty without expansion.
These findings are separate from confirmed writes and show the weaker
"may reach a database write through a dynamic call" message (or "unresolved
call" for a static receiver this analysis cannot establish). Such objects are
scheduled serially. HARMLESS objects with neither writes nor uncertainty retain
the database runtime guard. Risk still aggregates the object's test classes,
so a writing sibling test can make the object's other classes run serially.

Calls are read from abaplint's `MethodCallChain` and `MethodSource` AST nodes.
Field symbols, table expressions, `CAST`, `NEW` and chained factory returns
are recognized. Complex fields and type aliases use abaplint's declared types
from syntax scopes when the lightweight declaration index cannot resolve
them. This is a conservative call analysis, not whole-program value flow:
unavailable bodies, unknown types, dynamic targets, parser recovery and event
dispatch produce uncertainty. Events are not expanded to all system handlers.
Analysis failure is also visible as a weaker warning and runs serially.
Runtime values and arbitrary dynamic names are not guessed.

## Statement audit and database escapes

`tools/osd-unit-risk-statements.mjs` explicitly classifies every kind in
abaplint's statement registry. Known declarations, assignments, reads and
control flow are harmless at the statement level; their expression trees
are still scanned for calls, static initialization and construction. `CAST`
and `CONV` do not themselves instantiate a class; nested `NEW`, `THROW` or
factory calls do, and are followed even inside those expressions. Raising an
existing exception reference does not construct another exception.

An unmodeled statement is **unknown**, including any future parser kind.
It produces the weaker "may reach a database write through an unknown
<kind> statement" warning with its method and file:line. Macros, event dispatch,
kernel calls and unmodeled nonlocal execution remain uncertain. The registry
coverage test fails on an upstream kind with no explicit classification; the
runtime fallback stays unknown even before that audit is updated.

Writes include Open SQL data changes, COMMIT/ROLLBACK WORK, update-task
registration, SET UPDATE TASK LOCAL, CALL TRANSACTION, SUBMIT, EXPORT TO
DATABASE, and report/textpool/cluster changes. EXPORT to memory is harmless.
Native SQL, ADBC and AMDP are conservatively classified as database escapes,
even when SQL text, a library body or a database procedure is unavailable, or
the query claims to be read-only. An EXEC SQL block or AMDP body contributes
one escape finding, rather than counting each opaque parser chunk too.
ADBC calls also recognize inherited SQL statement/connection classes.
This policy preserves uncertainty for unknown execution without expanding to
unrelated classes or turning a database escape into a silent read.

## Reproduction and red proof

The reported fleet class is absent from `git ls-files '*fleet_report*'` in this
checkout. `test/unit-risk-calls.mjs` uses public synthetic names and an in-memory
ABAP fixture: `LTCL_TEST=>RUN` calls `ZCL_REPORT=>READ`, which selects three
tables. The report also has an unused interface-typed attribute and an unused
writing method. Two system-wide interface implementations exist; one writes.

Restoring the original `UnitRisk` implementation from the starting HEAD (`9e69f01d`),
substituting only the xref row provider with the fixture's `CrossReference`
rows, produced **5 reached objects and 2 writes**. Running the fleet test then
failed with `expected 2 to equal 0` (exit 1). The old warning named the report's
unused `COMMIT WORK` and "1 more". The fixed implementation produces **2 reached
objects, 0 writes, 0 uncertain calls and no warning**. These are fixture counts,
not an attempted reproduction of the private system's 1104 additional paths.

The path to the unrelated synthetic writer is:

```text
ZCL_TEST -> ZCL_REPORT     WBCROSSGT OTYPE TY (the actual static READ call)
ZCL_REPORT -> ZIF_STORE    WBCROSSGT OTYPE TY (unused DATA TYPE REF TO)
ZIF_STORE -> ZCL_WRITER    interface-to-every-implementer expansion
ZCL_WRITER=>ZIF_STORE~READ  COMMIT WORK, zcl_writer.clas.abap:3
```

The **first edge outside executable reach** is the report's type declaration.
The following interface expansion makes the error larger. Hypotheses checked
against the old implementation:

- All interface implementations are added unconditionally: confirmed.
- Type references are treated as calls: confirmed.
- Non-literal dynamic calls expand to every object: refuted; they were counted
  as writes themselves, while unrelated type references could still expand.
- Superclass calls expand to every subclass redefinition: refuted; the old
  graph follows subclass-to-superclass type references, with no reverse
  inheritance expansion. The new tests cover both instantiated and unused
  redefinitions.
- Framework/test-runner reach is implicit: refuted for the runner. Assertion
  references could enter the old type graph; the new graph follows actual
  assertion calls and excludes literal call text in assertion arguments.

The regression suite checks the read-only fixture, concrete COMMIT/INSERT/
MODIFY paths, both interface implementations, a reachable factory, unknown
receivers, dynamic calls, inheritance, constructors, call text inside literals,
and abbreviated source paths. To print the fixture's closure and old graph
edges, set `OSD_RISK_RED_PROOF=1` and run its `fleet fixture` test.

## Round 2 regression and scaling evidence

Restoring `689262da`'s analyzer against the expanded regressions yielded
**17 failing / 9 passing** for static components, superclass initialization,
inherited virtual dispatch, receiver forms and unresolved execution. The
failures include all four critic categories; forms already supported (such as
`NEW ...->method` and dynamic method calls) remain green. Restoring the original
object expansion again yielded the fleet fixture's **5 objects / 2 writes**,
and its no-warning test failed. The current fixture still has **2 objects /
0 writes / 0 uncertainties**.

`tools/bench-unit-risk.mjs` provides a reproducible sparse chain: each
class constructs and calls the next through its declared reference type. It
checks one reachable write and `N + 1` reached objects. Parsing is outside the
timer; each of five samples measures a fresh graph plus closure, and the
reported value is the median. This workload has a linear number of executable
edges. A system whose reachable calls actually dispatch to many compatible
receivers can have more edges and correspondingly more work.

Run it with:

```sh
OSD_HEAVY_RANGE=50-59 tools/osd-heavy.sh node tools/bench-unit-risk.mjs
```

The optional module argument permits the same workload against an older
analyzer. `OSD_RISK_BENCH_SIZES=100,200,400,1000` selects the chain lengths.
Counts and measured timings are recorded in the fix commit message.

## Round 3 regression proof

The two critic reproducers were added before changing `87e44923`'s analyzer
(rebased as `182deed0`).
`--grep 'critic r2'` gave **0 passing / 2 failing**: both exception construction
and native SQL reported zero writes. With the statement audit and construction
fix, both pass. The exception constructor is on the concrete write path; the
native block contributes one escape. The fleet fixture still has **2 reached
objects / 0 writes / 0 uncertainties**; none of its statement kinds needed an
unknown-default exemption. The registry test audits all **317** registered
kinds, plus the parser's synthetic kinds (including NativeSQL and Unknown).

```sh
OSD_HEAVY_RANGE=50-59 tools/osd-heavy.sh node node_modules/mocha/bin/mocha.js \
  test/unit-risk-calls.mjs --grep 'critic r2|fleet fixture|statement registry'
```

## Round 4 regression proof

Before changing the analyzer, the critic's literal dynamic `ASSIGN` regression
failed (**0 passing / 1 failing**) with **1 reached object / 0 writes /
0 uncertainties**. With the fix it reaches **2 objects / 1 write /
0 uncertainties**, and the warning shows the test-to-class-constructor path.
Related regressions cover literal and non-literal data/type names, dynamic
class and attribute names, superclass initialization, RTTI call forms, and
local/data-reference accesses. The fleet fixture remains **2 objects /
0 writes / 0 uncertainties** before and after this round.

Round 4 also treated type-only designations as initialization. Round 5 removes
that overreach: the token tests' `ASSERT_EQUALS` table comparison reaches RTTI's
`CREATE DATA ref TYPE (p_name)`, which creates data, not a class instance.
The integration noise guard now requires **0 writes / 0 uncertainties** and
HARMLESS parallel scheduling with the runtime database guard enabled. The
read-only run passes through that discovered plan. Literal static `ASSIGN`
still reaches **2 objects / 1 write / 0 uncertainties**; the fleet fixture
remains **2 objects / 0 writes / 0 uncertainties**.

## Round 5 scheduling audit

Risk discovery over every test-bearing object in this checkout found **96
objects / 131 test classes**. The main baseline is `origin/main` at `b3d1b5dc`;
the audit used that revision's analyzer and ABAP sources (restoring the two
ADT discovery sources that differ on this branch). It derives xref rows from
those sources, without a database or running tests. Library and generated
inputs are identical between the comparisons. Separate snapshots recorded
round 4 and the current analyzer against the branch's sources.

| Analyzer | HARMLESS parallel | Serial |
| --- | ---: | ---: |
| main | 33 | 98 |
| round 4 | 1 | 130 |
| round 5 | 39 | 92 |

Versus main, **34 classes in 26 objects change schedule: 20 serial →
parallel and 14 parallel → serial**; 97 classes keep their schedule. Each
changed case is listed below. The 14 extra serial classes already had these
findings before round 5: they reflect the earlier unresolved-execution policy,
including conservative interface-constant findings, not type-name uncertainty
introduced by this fix. No confirmed database write was found in those 14
classes. Versus round 4, **38 classes return to parallel and none become
serial**. `ZCL_OSD_ABAP_TOKENS` stays parallel versus main and returns to
parallel versus round 4, with 0 writes and 0 uncertainty.

| Object | Changed test classes | Main → branch | Reason |
| --- | --- | --- | --- |
| `ZCL_OSD_ADT_CHECKRUN` | `LTCL_PROTOCOL` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_CLASSRUN` | `LTCL_CLASSRUN` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_DISCOVERY` | `LTCL_DISCOVERY` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_ENTITY` | `LTCL_HELPER` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_LISTENERS` | `LTCL_LISTENERS` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_OBJECT` | `LTCL_OBJECT` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_REENTRANCE` | `LTCL_REENTRANCE` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_RIS_STATIC` | `LTCL_STATIC` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_SCAN` | `LTCL_HELPER` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_SEARCH` | `LTCL_SEARCH` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_SOURCE` | `LTCL_SOURCE` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_TREE` | `LTCL_TREE` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_TYPES` | `LTCL_HELPER` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_TYPESTRUCTURE` | `LTCL_TYPESTRUCTURE` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ADT_VFS` | `LTCL_VFS` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_BSP` | `LTCL_SPLIT`, `LTCL_BASE`, `LTCL_NAMESPACE` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_FORM_TEST` | `ZCL_OSD_FORM_TEST`, `LTCL_FORM` | parallel → serial | Unresolved request-interface call in `ZCL_OSD_FORM=>FIELDS`, line 77; the concrete request is supplied externally. |
| `ZCL_OSD_SXML_CONTRACT_TEST` | `LTCL_SOURCES`, `LTCL_NORMALISE`, `LTCL_CONTRACT`, `LTCL_READERS` | parallel → serial | Unresolved interface constants/static accesses in `EVENTS` (lines 223–244) and unmodeled execution in reader bodies; conservative uncertainty, not a confirmed write. |
| `ZCL_OSD_SXML_RECORDER_TEST` | `LTCL_RECORDER` | parallel → serial | Calls the same contract/reader paths as the contract tests; retains their conservative uncertainty. |
| `ZCL_OSD_SXML_STREAM_TEST` | `LTCL_STREAM`, `LTCL_PULL`, `LTCL_DATASET` | parallel → serial | Interface node-type constants in `NODE_API` (lines 53–71) and reader paths remain unresolved. |
| `ZCL_OSD_SXML_TEST` | `LTCL_READER` | parallel → serial | Reader interface constants in `CL_SXML_STRING_READER` (lines 1223–1247) and unmodeled reader execution remain uncertain. |
| `ZCL_OSD_TIMER_TEST` | `LTCL_TIMER` | serial → parallel | Main counted 472 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_OSD_ZIP_TEST` | `LTCL_ZIP` | parallel → serial | Dataset execution (`OPEN DATASET`, `TRANSFER`, `CLOSE DATASET`, `DELETE DATASET`) remains unmodeled and uncertain. |
| `ZCL_STG_ICF_DEMO` | `LTCL_STG_ICF_DEMO` | serial → parallel | Main counted 909 writes across dependency objects; executable test calls reach 0 writes and 0 uncertainty. |
| `ZCL_VDB_100_ANYDB` | `LTCL_RANK` | parallel → serial | Conservative unresolved interface constant `ZIF_VDB_100_ENGINE=>GC_MAX_DIMS`, line 33. |
| `ZCL_ZOSD_TEST_DEMO` | `LTCL_ZOSD_TEST_DEMO` | parallel → serial | Conservative unresolved interface constants in `GREET`/`STATUS_TEXT`, lines 31 and 45. |

The round-4 analyzer fails the new type-inspection noise guards (**21 failing /
2 passing**), including literal/dynamic `CREATE DATA`, casting, RTTI and
instance attributes. The dedicated internal-table `ASSERT_EQUALS` noise guard
also fails against round 4; it passes with the current analyzer and the real
assertion library. Restoring main's original graph expansion again makes the
fleet no-warning assertions fail: **5 reached objects / 2 writes**, versus
**2 objects / 0 writes / 0 uncertainty** now. The legacy type edge leaves the
report's executable reach at its unused interface reference, then fans out
to the unrelated writer implementation.

Focused validation passed **149 risk/call checks, 359 xref/closure/VSIX/ADT/size
checks and 55 suite-runner checks** (563 total). The suite manifest reports
287 ordinary and 5 grouped suites with no drift. The size guard reports no
breach in files this branch touches; six inherited main breaches remain
advisory. The structural leak scan read the six changed files and found zero
matches; the private identifier list is unavailable, so identifier-specific
coverage could not be completed.
