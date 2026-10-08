# adtlock — OSGo's KERNEL_LOCK host

`New(server, kernel)` installs both `hostclass` seams over one lock server and
ADT kernel. Steps are keyed by the `*abap.Session` the generated seam passes.
A bound ADT step keeps its pinned context; every other step opens a holder
session on first use and ends it at step end. A dump rolls back and retires
the context it ran in; a host-ended key answers `ErrSessionEnded`, including
after every `_WAIT` sleep.

`EnqueueWithSleep` exposes `enq.Server.EnqueueWith` through the host so retry
behavior can be tested with a fake clock. `cmd/osgo` owns only installation
and the dialog-step lifecycle; this package deliberately keeps that glue out
of the already-large command.
