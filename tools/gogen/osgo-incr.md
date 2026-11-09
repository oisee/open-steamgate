# osgo-incr.mjs — the per-object front-end cache of the osgo fast path

Measured and designed in `docs/osgo-fast-rebuild.md`, "The incremental front
end". This is the README of the module the house rule asks a self-contained
module for; the code comments here repeat only what a reader of the module
needs in order.

## What it is for

`osgo.mjs --fast` already proved (osgo-fast.mjs) that a save changed nothing
but the content of existing classes and interfaces since the live
generation. That proof made the Node build skippable; the front end still
parsed, syntax-checked and lowered all ~2 900 files / ~1 080 classes on
every save (22 s of the 47 s cycle). This cache takes the rest: a fast save
re-lowers the edited objects and their transitive dependents, and takes
every other object's lowered IR from the cache.

## Shape

```
build/osgo-incr/<generation>/        one directory per live generation,
  index.json                          small, read first: schema, tool identity,
                                      folders, objects, ABAP Unit owners, the
                                      lowering order, the class push order, the
                                      superclass map, wanted, diagnostics, the
                                      broken set, rtti, ownership, aliases, and
                                      per entry: file digests, deps, reads,
                                      pushed classes, anonymous-struct refs,
                                      portability, the entry digest
  e/<sha(key)>.bin                    per object: the lowered class IRs, the
                                      ordered writes its lowering made to the
                                      shared program state, the supplied
                                      contributions, the rtti typedefs (v8
                                      serialized, deflated, digest-checked)
  db.json                             the database statements per registry
                                      object, in the order DatabaseSetup makes
                                      them (proved equal to the real run before
                                      being written)
```

The newest three generations are kept. The cache is refused whole when the
front end itself changed (`toolIdentity()`, frontend-object-cache.mjs) or the
layer folders / object list / Unit owners differ.

## How a fast build assembles the program

1. **What to re-lower**: the edited objects (from the proof's changed files)
   plus, transitively, every object whose recorded `deps` include one -- deps
   are the registry objects the lowering read, the classes and interfaces its
   IR names, and the owner of every generated type name it spells (a
   structure a class first used is named after it). Entries whose IR did not
   serialize are always re-lowered.
2. **The registry**: every non-class object, plus the reference closure of
   the classes re-lowered -- their recorded reads **and deps** (the syntax
   pass resolves a type the lowering never asks the registry for: the model
   class behind a redefined method's signature) and every class whose name
   any member's text spells (a reference the lowering stubs out is in
   neither recorded set). Every member's references resolve against the
   registry, because abaplint's syntax pass checks them all. The parse, the
   syntax pass and the fresh lowering all shrink with that set.
3. **The shared state**: every re-used entry's recorded writes are replayed
   in the original lowering order into the collections the lowering reads
   (structures, constants, signatures, events, ...), `supplied` is merged
   from the per-class contributions, and the caught index (which CATCH takes
   the raised objects of which classes) answers from the recorded superclass
   map over the recorded `wanted`: the partial registry holds neither the
   chains nor the start set (its own selection drops what it does not
   know), and a CATCH lowered against a truncated chain would be emitted
   dead (`catchCond`'s `abap.IsA` against `false` -- the regression test
   builds exactly that).
4. **The lowering** runs through `compileProgram` itself (`incr` hooks,
   frontend.mjs), with the closure registry and the pre-seeded state, so the
   fresh IRs come out of the same code path a full build uses. Its writes to
   the shared collections are recorded per object (the same op proxy the
   write side uses).
5. **The merge**: classes in the recorded push order, every shared
   collection **in the order the full build's lowering wrote it** -- per
   object of the recorded sequence, the fresh writes of one that lowered
   again and the recorded writes of one taken from the cache, the global
   passes appended, as in a full build -- because the program digest
   (program-digest.mjs) and the emitted Go read several of them in
   insertion order; "reused first, fresh after it" names another
   generation. The rtti table is rebuilt over the recorded registry
   enumeration order (the dictionary interleaves with the class typedefs,
   and every registry class gets a superclass entry, null included); the
   ownership table over the recorded collection order. The final analyses
   are recomputed where the registry answers (interface methods, tables,
   locks, CDS views) and merged from the cache where it cannot (exception
   supers, ownership of absent classes, dynamic dispatch).

## What refuses (the full front end runs)

Anything the cache cannot prove, each with a reason printed as
`osgo incr: the full front end runs (...`:

- no cache of the live generation, wrong schema, another front end (tool
  identity), other folders, objects or Unit owners;
- a changed file that is not a class or interface, or a class the cache has
  no entry for;
- an entry that is unreadable or whose IR did not serialize;
- a syntax error in a re-lowered object (the full front end drops such an
  object from the program; that answer is not this edit's);
- an object outside the re-lowered set turning broken (the edit broke it);
- a fresh IR newly naming a shared anonymous structure (whether the full
  build would share it through the same abaplint type instance is exactly
  what a partial registry cannot prove);
- a class with interface aliases outside the fresh registry (its dynamic
  dispatch would resolve differently);
- the database statements not attributing per object (recorded at write time
  by comparing the reconstruction with the real `DatabaseSetup` run).

## The anonymous-structure substitute

abaplint keys anonymous structures (the row of a `RANGE OF`, an inline
`BEGIN OF` in a signature) by *type instance*, shared through the registry:
the first lowering to reach one names it, later users keep that name. A new
registry has new instances, so the cache answers the lookup by the component
names instead -- the same answer whenever the instance was shared, because
the recorded name is what the write-time build named that shape. A shape two
independent structures already share is not answered at all (a miss lowers
as the full build would, naming the structure after the class that reached
it), and a shape whose owner was re-lowered is not seeded either, because
its dependents were re-lowered with it.

## Cost

Write (a full build): ~3 s over the front end on this tree -- the write
transcript, the deps walk, v8-serializing the entries (~19 MB over 1 076
objects), the database attribution (which a mismatch turns off until the
next full build). Read (a fast save): see the phase table in the doc; the
re-lowered set shrinks with the edit, the registry closure and the entry
deserialization do not.

## Tests

`tools/gogen/osgo-incr.test.mjs` over a small tree with an interface used as
a reference type and a `RANGE OF` row shared through its signature: for a
method body edit, a new method, an interface constant and an interface
method gained with its implementation, the assembled program equals the full
one (classes, structures, constants, interface signatures, events, exception
supers, rtti, the table registry and the emitted Go); the doubtful cases
(wrong generation, unreadable entry, a syntax error in the edited object, a
changed front end) refuse. The real-tree proof (same generation, byte
identical files, fast against full) is recorded in the doc.
