# objstore -- ZOSD_STORE over abapGit-named files

What: the object store of the Go host, `CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'` answered over the
files the Node host answers it over (tools/osd-store.mjs, tools/osd-store-destination.mjs); filesystem reads
(LIST, READ, OBJECT, PACKAGE, PACKAGES, SEARCH), history from git, and writes; CHECK/ACTIVATE/TOKENS refused
(this binary carries no compiler). go/abap keeps `SetStore`, `StoreCall`, the `Store*` type aliases and the
session-first `ZOSD_STORE` adapter (Data in, tables filled). SYSTEM is tree-independent: IDENTITY answers
the installed three-field ADT identity; other known kinds refuse with Node's no-answer text and unknown
kinds refuse with Node's unknown-kind text.

API: `SetStore(root string, cfg []byte, reason string) error`; `SetSystemIdentity(Identity)`;
`Call(in map[string]*string) Answer`; `Config`/`Root` (the build's facts), `Answer` with `Row`, `Issue`,
`Tally`, `Revision`; `Identity`; `Capabilities`.

Invariants: the files are the truth and git the history, no second copy; the index is rebuilt per call; a
WRITE touches only a file inside a writable root; answers and their order match the Node destination field
for field (localeCompare order, JSON property order, and the scalar/table envelopes). The frozen proof is
`test/fixtures/osgo-store/destination-golden.json`: `tools/osgo-store-goldens.mjs` records the Node
destination, `tools/gogen/go/objstore/golden_test.go` compares Go, and `test/osgo-store-goldens.mjs` fails on
drift. A refusal is `EV_ERROR`, never a panic. No import of go/abap, no Session.
