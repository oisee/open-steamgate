# objstore -- ZOSD_STORE over abapGit-named files

What: the object store of the Go host, `CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'` answered over the
files the Node host answers it over (tools/osd-store.mjs, tools/osd-store-destination.mjs); filesystem reads
(LIST, READ, OBJECT, PACKAGE, PACKAGES, SEARCH), history from git, and writes. An injected `Compiler`
supplies CHECK and PARSE kind OUTLINE snapshots; ACTIVATE and TOKENS are still refused. go/abap keeps
`SetStore`, `StoreCall`, the `Store*` type aliases and the
session-first `ZOSD_STORE` adapter (Data in, tables filled).

The compiler boundary is the small `Compiler` interface in `compiler.go`: objstore chooses saved CHECK files or the OUTLINE version and builds answer
JSON/scalars, but owns no process lifecycle or diagnostic conversion. Provider availability is resolved before object shortcuts; nil or absent providers preserve standalone
CHECK and unknown-PARSE behavior. Indexed objects without active proof still receive an OUTLINE skeleton. `storecompiler.Adapter` supplies the concrete snapshot/client
adapter. CHECK with `IV_SOURCE` is deliberately unsupported in round 2 because contract-v1 snapshots can
pin only on-disk files, not Node's in-memory unsaved buffer; the gap is ratcheted in `tools/gogen/storecmp.mjs`.

API: `SetStore(root string, cfg []byte, reason string) error`; `Call(in map[string]*string) Answer`;
`Config`/`Root` (the build's facts), `Answer` with `Row`, `Issue`, `Tally`, `Revision`; `Capabilities`.
SYSTEM is tree-independent: IDENTITY answers
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
