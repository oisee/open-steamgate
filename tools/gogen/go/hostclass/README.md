# hostclass

This package is the generated Go program's host-replacement seam. It deliberately
depends on no generated code and does not import `osg/gogen/abap`: hosts set
ordinary Go callbacks, and generated ABAP classes convert values at their method
boundary.

Each replaced class is one exported variable. Its fields are named after methods
and use only scalar Go types. The first seam is `ZCL_OSD_ENQ_KERNEL`; add a
neighboring class-named variable when another host replacement is needed.

A callback returns `*Raise` to ask the generated method to raise an ABAP
exception. `Class` is the ABAP class name, `Factory` optionally names its static
factory method, and `Text` is the fallback message. Every other non-nil error is
a host failure and panics; it is never converted to an initial ABAP result.
