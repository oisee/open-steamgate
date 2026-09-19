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
