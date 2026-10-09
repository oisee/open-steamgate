# abapsite

`Site(stack)` returns the first `file.abap:line` of a Go stack. Generated
code carries `/*line file.abap:N*/` directives, so a panic's stack already
names the ABAP source; the unit runner (`tools/gogen/unit.mjs`) reports it
as the `where` of a failed row (abapiti, 2026-10-09). The caller picks the
stack: `debug.Stack()` inside the recovering function, or the kept stack of
an `abap.Rethrown`. The package does not import go/abap.
