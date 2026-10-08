# storecheck

Compiler-command orchestration for CHECK, CHECKRUN and PARSE OUTLINE.
The object store resolves immutable request facts under its mutex; this package
runs the injected compiler outside that mutex. It owns no process or store state.
RFC issues keep their existing JSON shape, while CHECKRUN preserves severity,
coordinates and conditional URI from Node's shared report builder.
