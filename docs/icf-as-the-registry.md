# One registry for "who answers this path"

*A design note, 2026-09-19, written to be argued with rather than followed.
Nothing here is built; the counts are measured and the rest is a proposal.*

## The measurement that starts it

Ask this tree who serves a given path and four places answer:

```
ICF nodes (src/**/*.sicf.xml)          8
express routes across the two hosts   21
pack mounting (tools/osd-packs.mjs)    4
destinations (osd-remote-service.mjs)  6
```

Nine ABAP classes implement `if_http_extension`; eight nodes declare one.

That is the shape this repository spent a day removing at small scale — a
decision that belongs to the whole, taken in code that can only see one
participant — except here it is the architecture. Four registries cannot
disagree loudly. They disagree by one path behaving differently from how the
tree says it behaves, which is the failure that takes longest to find.

## The form is not ours to invent

ICF already is the abstraction: **a path belongs to a node, a node names its
handlers, a handler is code the system holds.** A node carries a *list* of
handler classes, and nodes have kinds — a service, an external alias, a
redirect. So the proposal is to reproduce what a system already does, not to
design something better than it.

| kind | who answers | what it removes |
| --- | --- | --- |
| **ABAP** | a class implementing `if_http_extension` | nothing — this is what exists |
| **BSP / WAPA** | a handler reading the object store | the one place where a request path is *not* ABAP |
| **PROXY** | a destination, to another system | the destinations registry |
| **RFC** | a system reached over RFC (Track R) | a separate track for reaching what is not published |
| **JS** | a Node function, for what transpiled ABAP cannot do | nothing, and that is the point — see below |

## What it unblocks, concretely

- **G.5 stops being a screen over a table.** Editing a node changes what
  answers, because the node *is* the registry rather than a picture of one.
  That is the spine of the demonstration chain, not its shop window.
- **Delivery comes free.** A node is an object, so "make this path answer"
  travels through abapGit with everything else, and a system that imports the
  repository gets the routing rather than a document describing it.
- **Track R stops being a track.** "This path is answered by a system we
  reach over RFC" is a node kind, and the services a system never published
  become reachable without a second mechanism.
- **The preview gets the same tree** instead of its own wiring.

## What it costs, said now rather than after

- **A JS handler is a hole in the property that makes this project what it
  is** — that the same code runs in a system's ICF. It is needed (abaplint,
  the transpiler and the file system are not reachable from transpiled ABAP),
  so the tree has to be able to say **which nodes can travel and which
  cannot**, and a node that cannot must say so in the object rather than in
  somebody's memory. Otherwise there are two worlds again, behind one facade.
- **The preview has no server at all.** A proxy node cannot work there, and
  that has to be a **declared refusal** rather than a silent gap. Four
  instruments in this repository have cost a day each by answering "nothing
  found" where the honest answer was "nothing was looked at".
- **Handlers are a list, not a handler.** That is how a real system does
  filters and authorisation. We have one per node. Not a blocker, but the
  shape should be a list from the start or it will be retrofitted badly.
- **This makes the design smaller, which is the only argument for it.** It
  adds no fifth way to answer a request; it deletes three of the four places
  that currently decide.

## What would prove it rather than assert it

One path, served today by express, moved to a node — and the count of
registries goes from four to three without anything else changing. If that
move is awkward, the design is wrong and this note should be edited rather
than defended.

See also: [`rfc-channel.md`](rfc-channel.md) for what D.4 and D.5 already
are, [`a4h-deploy.md`](a4h-deploy.md) for what a node does and does not fix
on a real system, and backlog Track R for the RFC kind.

---

## Correction, 2026-09-20: the only **registry**, not the only **router**

*Alice read the note and the night's work and said the thing neither session
had: a JS node can be served by the JS part of the system, and what matters
is that everything shows up in one place that can be inspected and changed
from ABAP. She asked to be criticised. She is right, and the evidence is in
SAP's own dictionary.*

`ICFHANDLER` is a transparent table:

```abap
key icf_name   : icfname      the node
key icfparguid : icfparguid   its parent
key icforder   : icforder     the order
key icftyp     : char1        the TYPE of handler
    icfhandler : icf_hand     a NAME
```

So in the thing we are imitating: the registry is a **table**, a node has an
**ordered list** of handlers, each row carries a **type**, and the handler
itself is a **name**. The tree does not care what is behind the name.

**The note above invented a rule the original has a column for.** It said a
JS handler must be an ABAP class delegating to the host -- the shape
`W3MI_LOADER` and the RFC `live` destination already use. That is a good
pattern for *content*; it is the wrong answer to *who executes a node*,
because the tree already has `ICFTYP` and does not need us to disguise one
kind as another.

**The error has a name: the claim conflated the registry with execution.**
Routing is execution; a registry is data. "ICF is the only router" forces
one execution model on everything. "ICF is the only registry" does not, and
it is the claim that is actually true of a system.

### What the conflation cost, measured

Serving five Fiori applications through ABAP on 2026-09-19/20 proved a node
can decide, and charged for it:

```
gen/bsp/zcl_stg_bsp_registry.clas.abap   137.9 KB of base64 in generated source
a page through the node                  ~0.003 s
the same page through express.static     ~0.001 s
```

Three times slower and a class that grows with every byte of every asset.
Those costs bought **unity of the registry** -- and under the corrected
model the same unity is free: the node says which application a path is,
the handler type says who serves it, and ABAP-for-portability against
host-for-speed becomes a setting rather than an architecture.

### The two risks in the corrected model, and neither is small

**A unified registry makes the inventory honest and says nothing about
portability.** If a node may be served from JS, then "the same thing runs in
a system's ICF" can quietly stop being true for more and more nodes while
the registry reports that all is well. So a handler type must carry whether
that kind exists on a system. That is fable-osd's requirement -- a node must
say whether it can travel, in the object rather than in somebody's memory --
arriving from the other side, and it is better here: not a flag of ours to
maintain, but a property of the type.

**"Changeable" is the expensive half.** Today a node is a file read at build
time. Inspectable and changeable at runtime means the registry is a **table
seeded from the objects**, which is exactly how SICF works -- objects
transport, the tree lives in a table. This tree already has that pattern
(`data/*.tabu.json` seeds tables from abapGit objects) and it carries an
obligation with it: two representations, one authoritative at runtime, and a
written rule for what happens when they disagree. There is such a rule for
the database (schema drift: move aside and say so). There is none for this
yet, and inventing it late is how a table and its objects come to disagree
in silence.

### It also fixes something made the same night

Destinations are SM59, and SM59 is a table too. If the registry is
inspectable from ABAP then so are destinations, `.local/destinations.json`
becomes a **seed rather than a source**, and the preflight asks the system
instead of a file.

### What survives from the original note

The falsification -- a registry is migrated when its **code is deleted**,
not when a path moves. The scoreboard. And the central claim, which gets
*stronger*: it stops requiring that everything execute the same way, which
was the part that could not be true.

### The order this implies

1. **The registry becomes a table**, seeded from `*.sicf.xml`, read and
   written from ABAP. This is G.5 -- not a screen over files.
2. **A handler carries a type** -- ABAP / HOST / PROXY / CONTENT -- and each
   type records whether it travels.
3. **Pages move out of the generated class and into a table**, which removes
   both the growth and the rebuild on every image, and lets `CONTENT` be
   served from ABAP or from the host by configuration.

The first is the one to take, because without the table "inspect and change"
is a word, and with it the other two are rows in it.
