# hostclass

This package is the generated Go program's host-replacement seam. It deliberately
depends on no generated code and does not import `osg/gogen/abap`: hosts set
ordinary Go callbacks, and generated ABAP classes convert values at their method
boundary.

Each replaced class is one exported variable. Its fields are named after methods
and use only scalar Go types, after a first `step any` argument: the calling
step's `*abap.Session`, the key for a host's per-step state. The first seam is `ZCL_OSD_ENQ_KERNEL`; add a
neighboring class-named variable when another host replacement is needed.

A callback returns `*Raise` to ask the generated method to raise an ABAP
exception. `Class` is the ABAP class name, `Factory` is required and names a compiled static
factory returning a reference, with every parameter OPTIONAL or DEFAULT. The
factory is called with those parameters omitted, just like an ordinary ABAP
call. `Text` is diagnostic text for `Error()` only; it never builds an exception.
A missing class, missing or misspelled factory, a factory not compiled into the
program, or one outside the replaced class package's visible layers panics with
`abap.NotCompiled` naming `Class=>Factory`. A plain exception without a factory
therefore fails loudly. Every other non-nil error is
a host failure and panics; it is never converted to an initial ABAP result.

`KERNEL_LOCK` is deliberately different: it is the host seam behind every
`ENQUEUE_<object>`, `DEQUEUE_<object>` and `DEQUEUE_ALL` call, not a compiled
ABAP class. Its callbacks use `osg/gogen/enq` values and the current dialog
step as `any`; the generated call wrapper builds requests and maps classic
exceptions. A nil callback preserves the generated caller's `NotCompiled`
refusal, as before this seam existed.
