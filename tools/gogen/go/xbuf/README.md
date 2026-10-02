# Owned xstrings

`Buffer` holds mutable bytes for an individual xstring that the Go compiler
proves never escapes through an ABAP reference. Its zero value is empty.
It must never be copied as a Go value. Local declarations and private instance
attributes can use it; parameters, static/interface attributes, components,
table rows and uncertain access retain the existing string representation.

Whole reads return independent string snapshots and whole writes copy in.
Substring reads copy only the selected bytes. Equal-length replacement uses
`copy` without allocating; unequal replacement splices. First-operand
self-concatenation uses amortised slice append, after evaluating other operands.
Bounds come from `bytesection`, the same contract as ordinary byte replacement.
No mutable view or unsafe string conversion is exposed.

The frontend records reference hazards from parsed source even when a method
is not emitted. The emitter then checks IR use positions conservatively; an
unknown write/reference position disqualifies the variable. Dynamic names,
friend access, exposed attributes, opaque native methods and whole-object
actuals also retain ordinary storage conservatively. This does not
change any method signature or generic `abap.Data` descriptor. Any statement
that reads a slot beside a method or function call retains ordinary storage, preserving Go operand evaluation order for whole, substring
and length reads. Call-free byte stores and appends keep owned storage.
Small whole-value assignments release backing arrays larger than four times
the new value.
Buffers belong to the same serialized ABAP session/object as their variables;
this package does not add independent concurrency or reference semantics.
