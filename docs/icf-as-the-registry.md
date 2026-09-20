# One registry for "who answers this path"

*A design note, 2026-09-19, written to be argued with rather than followed.
**Built since, 2026-09-20** — so the proposal is kept for what it claimed and
the outcome is recorded under it, including where the claim was wrong. The
working plan is [`icf-registry-plan.md`](icf-registry-plan.md).*

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

| kind | who answers | works in |
| --- | --- | --- |
| **ABAP** | a class implementing `if_http_extension` | server, binary, preview |
| **HOST** | a function of the JavaScript host | server, binary — **not** the preview |
| **PROXY** | a destination, to another system | server, binary |
| **CONTENT** | bytes out of the object store | everywhere |
| **NODE** | nothing: a node that exists and carries no handler | — |

*The kinds as first drafted had a **JS** row and a **BSP/WAPA** row. Both were
wrong in the same way: they named an implementation where the question is
where the node is **declared**. A path answered by JavaScript is a `HOST`
node and the distinction that matters about it — does it transport — follows
from the file it is declared in, not from a field somebody keeps true. `NODE`
was missing entirely and is the commonest kind on a real system: a UI5
application's node carries no handler and inherits one from the branch above
(measured on A4H, 2026-09-19).*

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

*As drafted:* one path, served today by express, moved to a node — and the
count of registries goes from four to three without anything else changing.

**That test was replaced by a stronger one, and the replacement should be
read as a correction rather than a refinement.** Counting registries answers
the wrong question: a place that *declares* a node and a place that *decides*
what answers are not the same thing, and the count conflated them. The test
that was actually run:

- a row edited to inactive (`UPDATE icfservice SET icfactive = ' '` on
  `/sap/bc/zork/`, marked `EDITED`) makes that path answer **404**, and an
  untouched path still answers 200;
- a node that exists **only as a row** — `/sap/bc/osd/onlyrow/`, named by no
  file anywhere — answers **200** and appears on the screen.

The second is the decisive one: under the old shape it would have been
unreachable however correctly the registry described it.

## What it measures now, and what it did not fix

Measured 2026-09-20, `node tools/osd-nodes.mjs` and `node tools/osd-routes.mjs`:

```
30 nodes: 19 ABAP, 10 HOST, 1 NODE
 0 express registrations nobody declared
 0 declared HOST nodes no registration serves
 3 answer on a path a real system delivers, so they must not travel
```

Places that **decide** what answers: one. Places that **declare** a node:
five — `*.sicf.xml`, `<layer>/icf/nodes.json`, the `ICFSERVICE` /
`ICFHANDLER` rows, a destination, a pack. So the drafted promise, "it deletes
three of the four places that decide", came true of deciding and is false of
declaring, where the number went up. That is the better trade and the note
should not be read as having predicted it.

The finding that justifies the track on its own is one nobody was looking
for: **three of our nodes answer on paths a real system delivers** —
`/sap/bc/gui/sap/its/webgui`, its `sapevent` child, and
`/sap/bc/ui5_ui5/sap` — and until the inventory said so, nothing stopped them
being packed into a zip meant for a system. It fell out of separating *what
implements a node* from *whether the node travels*, which is a distinction
this note did not have.

*Corrected 2026-09-20, and the correction is the more useful half.* This
first said such an import **would replace** SAP's handler, and that is not
established. Read in the clone rather than assumed:
`zcl_abapgit_object_sicf` identifies an object by `ms_item-obj_name`, which
is `icf_name(15)` plus `icfparguid`, and creates the node with
`insert_node( icf_name = is_icfservice-orig_name, icfparguid =
find_parent( iv_url ) )`. The key is the **name and the parent GUID**, not
the URL. So an import may nest a node, collide, or fail — and none of ours
is even written in abapGit's SICF naming. The conclusion "these must not
travel" survives; the mechanism given for it was invented, in a sentence
confident enough that it reached three commit messages before anybody opened
the file.

**One defect is open and it is in the load-bearing claim.**
`tools/osd-serve.mjs` mounts ABAP nodes from the rows
(`from: servicesFromRows(icfRowsNow)`); `test/start.mjs` mounts them from the
files, and `MODE` defaults to `inline`. `servicesFromRows` has exactly one
caller in the tree. So "changing a row changes what answers" is true of the
serving host and **not** of the default one, and no test asks: the registry
suite exercises `applyAtStartup` and the rows directly, never the inline
host's routing. It is the shape `docs/luw-buffer.md` already records — a rule
written next to one caller does not survive the second — arriving a third
time, in the sentence the whole track exists to make true.

See also: [`rfc-channel.md`](rfc-channel.md) for what D.4 and D.5 already
are, [`a4h-deploy.md`](a4h-deploy.md) for what a node does and does not fix
on a real system, [`registry-drift.md`](registry-drift.md) for what happens
when the objects and the rows disagree, and backlog Track R for the RFC kind.
