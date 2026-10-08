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

`Handle(id)` exposes the existing lock-server handle for request-local
ENQUEUE, COMMIT and ROLLBACK calls. `DropContext(id)` releases a dumped
context without marking its key ended, allowing its next bind to open anew.
These operations are synchronized; no process-global current request is set.
Use one kernel per host/server. The host must own step pinning and defer dump
cleanup until its last pinned step exits; this package supplies no work-process
scheduler or WAIT continuation. Notify it through `DropContext`/`End` rather
than ending handles directly on the server, since `ContextAlive` deliberately
matches Node's host map rather than inferring life from lock rows.

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
