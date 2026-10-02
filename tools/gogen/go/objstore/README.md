# objstore -- ZOSD_STORE over abapGit-named files

What: the object store of the Go host, `CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'` answered over the
files the Node host answers it over (tools/osd-store.mjs, tools/osd-store-destination.mjs); history from git,
CHECK/ACTIVATE/TOKENS refused (this binary carries no compiler). go/abap keeps `SetStore`, `StoreCall`, the
`Store*` type aliases and the session-first `ZOSD_STORE` adapter (Data in, tables filled).

API: `SetStore(root string, cfg []byte, reason string) error`; `Call(in map[string]*string) Answer`;
`Config`/`Root` (the build's facts), `Answer` with `Row`, `Issue`, `Tally`, `Revision`; `Capabilities`.

Invariants: the files are the truth and git the history, no second copy; the index is rebuilt per call; a
WRITE touches only a file inside a writable root; answers and their order match the Node destination field
for field (localeCompare order); a refusal is `EV_ERROR`, never a panic. No import of go/abap, no Session.
