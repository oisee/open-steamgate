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
  when present in the scalar answer; go/objstore does not yet produce it.
- Revision: the ABAP probe covers the table shape and replacing stale rows.
  TestStoreRevisionFullSubject is the red/green row projection test: it preserves
  a full Unicode subject independently of the shortened SUBJECT. The current
  go/objstore Revision has no SUBJECT_FULL field and truncates SUBJECT to 80
  characters. The adapter forwards SUBJECT_FULL when the backend adds it and
  keeps it initial for this older backend. Backend work is explicitly outside
  this task's permitted files.
