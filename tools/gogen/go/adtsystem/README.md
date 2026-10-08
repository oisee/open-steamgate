# ADT SYSTEM answers

`Provider` projects a request's resolved ABAP session and persistent handle
rows through `Sessions`, and its lock server through `Holders`. It answers
SESSION, LOCK_HANDLE, LOCK_RELEASE and LOCK_HOLDER as tools/adt-enq.mjs does.
Missing views leave session kinds unanswered; dead sessions refuse adoption;
unknown handles return an empty object. Alive checks can end expired holders.

`Bindings` belongs to a host and keys providers by the calling dialog step.
A yielding step keeps its own provider while other steps run. OSGo's generated
adapter captures the ABAP session view after RESOLVE and passes the provider
explicitly into objstore. `ENQHolders` uses the shared lock server's collision
rules and the kernel's live or retired handle-to-key mapping; foreign holders
remain opaque. This package has no ABAP runtime import.
