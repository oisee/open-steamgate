# adtenq — ADT ENQ kernel bridge

`New(server)` builds the host side of `ZCL_OSD_ENQ_KERNEL` over an
`*enq.Server`, with no dependency on the generated ABAP runtime.
All kernels use one process owner with a random `adt:<12 hex>:` prefix.
`NewOwner` creates an independent host identity; `Owner.Prefix`, `Key`,
`IDOf` and `Owns` mirror `tools/adt-enq-key.mjs` without trimming.

`Kernel.Bind(id, user)` opens or reuses a context, retaining the first user.
It returns `(false, nil)` only for a host-ended key, corresponding to Node's
`EnqSessionEnded`; missing/closed-server failures return errors.
`End(id)` releases the context and remembers even never-bound keys;
`Revive(id)` forgets that refusal without opening a context or restoring locks.
`ContextAlive(id)` checks the host's context map, including contexts with no
locks. `Owns(id)` tests only the prefix; `SessionID(id)` strips only our prefix.
All six kernel methods trim trailing ECMAScript whitespace like
`tools/osd-enq-session.mjs`; foreign keys remain opaque.
The ended-key ledger retains the latest 10,000 distinct keys in insertion
order, with repeated ends refreshing that order, as on Node.

`Handle(id)` exposes the current lock-server handle for request-local ENQUEUE,
COMMIT and ROLLBACK calls. `Pin(id, user)` atomically opens or reuses a context
and counts a step pinned to its returned handle; `Unpin(sid)` releases that pin.
`DropContext(id)` immediately retires the key's current handle without marking
the key ended: `ContextAlive` becomes false, the next bind opens a replacement,
and the old handle—and only its locks—ends when its last pin leaves. A host
`End` ends both the current and retired handles for that key. These operations
are synchronized; no process-global current request is set. Use one kernel per
host/server. This package supplies no work-process scheduler or WAIT
continuation. Notify it through `Pin`/`Unpin`/`DropContext`/`End` rather than
ending handles directly on the server, since `ContextAlive` deliberately matches
Node's host map rather than inferring life from lock rows.

Once the gogen host-replacement seam lands, `cmd/osgo` will create the kernel
in `init()` and set generated `HostZCL_OSD_ENQ_KERNEL_*` variables to adapters
for `Bind`, `End`, `Revive`, `ContextAlive`, `Owns` and `SessionID`. The adapters
convert generated ABAP values and booleans and panic with a generated
`ZCX_OSD_ADT` object for errors, using gogen's exception helper. Binding must
also install `Handle(id)` in the host's request-local execution context.
That seam and installation are pending; this package does not import
`osg/gogen/abap` or install itself.

Tests port lifecycle and ownership cases from `test/osd-enq-abap.mjs` and
`test/adt-abap-session.mjs`, plus failure, retention and concurrent-call cases:

```sh
GOCACHE=/tmp/osgo-gocache go test ./adtenq ./enq -race -count=3
GOCACHE=/tmp/osgo-gocache go vet ./adtenq
```
