# ADT batch 1 probes

`unit.mjs --fixture tools/gogen/testdata` includes these probes. Local before/after
results are in `.local/adt/red.txt` and `.local/adt/green.txt`.

- WHERE NP: supplied A4H answer `/other`; the other string operators use the
  already measured logical-expression helpers.
- Timestamp: supplied UTC answer `20261007` / `231500`; reverse and initial
  timezone use UTC. The installed JS runtime's convert statement sets subrc 4
  for the initial timezone and 0 for UTC. Other zones are named refusals.
- Message: the installed JS runtime confirms msgid/number/type and the four
  WITH values (local field-only oracle run). Its MESSAGE ... RAISING currently
  does not raise a classic exception, so the complete JS probe fails with
  subrc 0. The Go probe requires the requested EXCEPTIONS mapping, 1 or OTHERS 2,
  for both a method and an FM; message fields stay in the Session.
- Calculations: supplied days 20733 and seconds 83700. `npm run osgjs:unit --
  tools/gogen/testdata/adt-cases --class ZCL_ADT_CALC --json` confirms lines + 1
  and the signed c(10) answers `        2 ` and `        2-`. Go reuses packed
  MOVE's signed alignment; trailing c blanks are implicit internally.
- Exception: the same JS run selecting ZCL_ADT_RERAISE confirms catch/root,
  re-raise/original class and object equality. REF TO object additionally
  exercises dynamic raising; the front end narrowly accounts for abaplint's
  rejection of GenericObjectReferenceType in RAISE.
- Store: this is a host API, not an A4H oracle. COMMANDS returns the backend's
  JSON; IV_JSON already passed through storeInputs. EV_STATE is passed through
  when present in the scalar answer; the round 1 backend snapshot did not
  produce it.
- Revision: the ABAP probe covers the table shape and replacing stale rows.
  TestStoreRevisionFullSubject is the red/green row projection test: it preserves
  a full Unicode subject independently of the shortened SUBJECT. The round 1
  go/objstore Revision had no SUBJECT_FULL field and truncated SUBJECT to 80
  characters. The adapter forwards SUBJECT_FULL when the backend adds it and
  keeps it initial for this older backend. Backend work is explicitly outside
  this task's permitted files.

The final emitter compatibility pass uses existing native statement IR for
CONVERT and MESSAGE operations. String WHERE predicates use existing boolean
expression IR, so the second emitter can still compile the same graph.

Final checks: frontend/emission trio 49/49; semantics 369/369; full fixture
32/32 classes compiled, 112/112 SUCCESS; unit harness 23/23; Go runtime 118
listed top-level tests, normal and race runs passed. Disposable harness builds
needed GOFLAGS=-buildvcs=false after Git VCS stamping failed with exit 128;
no test was disabled. GOCACHE stays in tools/gogen/.out/go-cache.

## Round 2 host contracts

The STORE signature audit compared every IV_/EV_/ET_ parameter in
src/webgui/zosd_store.fugr.xml and tools/osd-store-destination.mjs. EV_CHANGED
was the only omission; all parameters now match. The STORE probe passes that
parameter on COMMANDS and checks its initial value (this older local backend
does not supply it for COMMANDS). Scalar answers are already copied by name.
The adapter comments now describe the backend's EV_JSON, EV_STATE and
SUBJECT_FULL outputs; the reflective revision mapping remains compatible with
a backend without SUBJECT_FULL.

The host fixture contains the production ONE_RUNTIME method in a minimal
class. The kernel-guard fixture copies the production class. The three tests
call ONE_RUNTIME, HAS_SERVING_DATABASE and HAS_GENERATION. All three return
ABAP false, matching the decided osgo datapreview contract and Node's parent
kernel / non-one-runtime case, regardless of Node environment settings.
Each was NOT_COMPILED before the mappings and SUCCESS afterwards. Evidence,
including the STORE signature refusal, is in .local/adt/red.txt and green.txt.

Every WRITE @KERNEL in src/adt/zcl_osd_kernel_guard.clas.abap was reviewed:

- Line 18: HAS_SERVING_DATABASE overrides the preceding abap_true with space.
  ADTUnavailable supplies the initial CHAR representation (trailing blanks
  are implicit in Go).
- Line 24: HAS_GENERATION uses the same unavailable answer; the parent kernel
  makes the condition true even when one-runtime is configured.
- Line 30: try opening an exception boundary around CREATE OBJECT and MAIN
  cannot be expressed by fn/args, loop, bound or end.
- Line 33: catch needs recovery from a host failure and a bound error, which
  none of those forms supplies.
- Line 34: EV_FAILED = X must run only in the catch branch. An unconditional
  function call would falsely report failure on success.
- Lines 35-37: EV_NAME, EV_MESSAGE and EV_STACK require the caught host error,
  absent from the allowed forms and the method's ABAP variables.
- Line 38: closes the catch boundary; end only closes a mapped loop.

CALL_CLASSRUN therefore remains refused, as TASK2 explicitly requires when
a line cannot be expressed. No mapping silently skips that boundary and no
new map form was introduced. Generation being unavailable keeps the intended
capability answer conservative; it does not implement CALL_CLASSRUN.

Round 2 regressions: frontend/emission 49/49; semantics 369/369; fixture
34/34 classes compiled, 115/115 SUCCESS; unit harness 23/23
(GOFLAGS=-buildvcs=false, zero skipped); Go runtime 118 top-level tests,
normal and race passed.

The initial harness run failed because Go VCS stamping in disposable builds
returned exit status 128. A focused reproduction confirmed that error; the
complete rerun with GOFLAGS=-buildvcs=false passed all 23 tests. No test was
disabled. Commands and raw results are in .local/adt/round2-*.log and
round2-results.json.
