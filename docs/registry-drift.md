# When the table and the objects disagree

*Written 2026-09-20, **before** the table exists. `docs/icf-registry-plan.md`
step C (= backlog G.5) is "the registry readable and writable from ABAP", and
it has been blocked on this: this tree has a rule for what happens when a
database and the DDIC it was seeded for disagree, and none for what happens
when a configuration table and the objects it was seeded from disagree. A
rule written after the table is a rule written to excuse whatever the table
already does.*

---

## The question

G.5 puts the ICF nodes in a table an ABAP screen can read and write. Then
somebody changes a node from that screen, a build brings a changed
`*.sicf.xml`, and the two say different things. Which wins, and what is the
person told?

## The answer, and it is SAP's

**On a real system the objects *are* the table.** There is no second store:
`ICFSERVICE`, `ICFHANDLER` and `ICFSERDESC` are the registry, SICF is a
screen over them, and abapGit writes those rows directly when it imports a
`*.sicf.xml`. The file is a **transport**, not a source.

So:

1. **The table is the truth at runtime.** Not the objects, not a file read on
   every request. What answers a path is a row.
2. **An object is applied when it arrives**, meaning its content changed --
   an import, a pack, a build that carries a new node. Not on every start.
   Re-applying on every start would undo every runtime edit, silently, and
   the screen would be a picture of a registry rather than one.
3. **Going the other way is an export**, and it is the same file format. A
   node made from the screen becomes a `*.sicf.xml` when somebody asks for
   one, the way `segw:tree export` already writes a project back.

And a consequence worth stating because it decides the table's shape: **do
not invent `ZOSD_ICF`.** Implement `ICFSERVICE` and `ICFHANDLER`. ABAP that
reads SICF the way a system does then works here unchanged, and
`tools/osd-icf.mjs`'s parse becomes the seeder rather than a second reader.
This is the one place where imitating the interface *is* imitating the
storage, because SICF's interface is its table.

## The disagreement, case by case

The rule keys off **who last wrote the row**, which the table records --
`SEEDED` or `EDITED`. Without that column every case below collapses into a
guess.

| the table says | the object says | what happens |
| --- | --- | --- |
| nothing | a node | inserted. A new object is how a node arrives |
| `SEEDED`, unchanged since | something different | replaced, quietly. Nothing a person did was lost |
| `EDITED` | something different | **replaced, and the previous row is kept aside and reported** |
| `EDITED` | nothing (the object is gone) | kept, and reported as a node no object explains |
| `SEEDED` | nothing (the object is gone) | removed, **and reported**. It was only ever the object's, but it is the one action that takes a path away, so it is not quiet |
| nothing recorded | nothing (the object is gone) | removed. **A row nothing is known about is the seeder's**: nothing else has ever written one, and treating an unrecorded row as edited would keep every stale node forever the first time this table is lost |

The third row is the whole question, and the shape of the answer is taken
from the rule this tree already has for schema drift: **move aside, say so,
never silently.** That rule is in `tools/sqlite-file-client.mjs` and it was
paid for -- a database moved aside while a runtime still had it open took the
i7 down for eight hours, which is why the sidecars now travel with it.

## What an unmarked edit actually costs

*Added 2026-09-20 because the sentence used everywhere else -- "without the
bookkeeping the next build silently undoes the edit" -- is stronger than the
code, and it had reached three commit messages, a YAML comment and an app
component before anybody read the branches back.*

The decision is a three-way, and only one arm loses anything:

| the object | the row | what happens |
| --- | --- | --- |
| unchanged since it was applied | marked or not | `KEEP`. The edit stands either way |
| changed | marked `EDITED` | `ASIDE`. The object wins, the previous row is kept and the start says so |
| changed | **not** marked | `REPLACE`. The object wins **silently** |

So an edit made round the bookkeeping is not undone by the next build. It is
undone, without a word, **on the day its object next changes** -- which may
be weeks later and will not be connected to that build by anybody looking.
Quieter and later, and therefore worse than the thing the stronger sentence
described.

That is the argument for putting `markEdited` in what the dispatcher writes
through rather than in one screen: not that the alternative breaks loudly,
but that it breaks quietly at a time nobody is watching.

## What this rule refuses to do

**It does not merge.** A three-way merge of a node -- what the object said
last time, what it says now, what somebody typed -- needs a fourth store for
the base version and a conflict model nobody asked for. Replacing and keeping
the old row aside is one store and one report, and a person can read both.

**It does not make configuration out of seed data.** `data/*.tabu.json` is
re-seeded whenever the generation changes, and a row written at runtime does
not survive it. That is **correct for seed data** -- nobody edits a flight
booking fixture on purpose -- and it is exactly why the registry must not be
seed data. If the ICF table were seeded the way `ZSTG_DEMO` is, every node
somebody made from the screen would vanish at the next build and the screen
would be a toy. (That one is exact: a re-seed writes the rows back whatever
they say. The weaker case -- an edit made round the bookkeeping -- is in
"What an unmarked edit actually costs" below, and is quieter.) The two kinds of row look identical in SQLite and are not the
same thing.

## How anybody will know it works

The falsification, so the rule is not judged by the code that implements it:

- edit a node from ABAP, rebuild **without** changing its object, restart:
  the edit is still there. (If this fails, the table is seed data.)
- edit a node, change its object, restart: the object's value answers, and
  the start reports the row it set aside, naming the node.
- delete an object whose row was edited, restart: the row still answers and
  is reported as unexplained.
- delete an object whose row was never edited, restart: it is gone, quietly.

Each of these is a test before it is a paragraph.

## The rule as something that decides

`tools/osd-icf-apply.mjs` is the five cases above as a **pure function** over
three inputs -- what the objects say, what the table holds, where each row
came from -- and `test/osd-icf-apply.mjs` is the four falsifications plus the
one that makes "writable" mean anything: an object that has not changed since
it was applied changes nothing, whatever the row says now.

It touches no database on purpose. The interesting part of the rule is which
action is chosen, and a rule entangled with the writing of rows can only be
checked by writing rows.

One case the prose above did not name and the code had to: **the handler
chain is part of "has the object changed".** A node whose class changed and
whose URL did not has changed, and a hash over the service row alone would
call it unchanged and never apply it.

## What is still open

**What "aside" keeps.** `ZOSD_ICF_ASIDE` holds the node, the URL, the
handlers as a comma-joined list, when and why. That is **not the previous
row** -- the handler order and type are lost, and the descriptions are not
kept at all. Enough to see what was replaced and by what; not enough to put
it back. Say so rather than let the word "kept" carry more than the table
does (codex-sol, 2026-09-20).

**The content hash is not canonical.** `JSON.stringify` over the service
row depends on property insertion order and drops `undefined`, the handler
chain is joined with a delimiter that could appear in a value, and the
digest is truncated to 64 bits. Two objects that differ can collide and one
object can hash differently across runs if the row is ever built by another
path. It has one producer today (`rowsOf`), which is why this has not bitten;
a second producer is what would make it bite.

**Where "aside" is.** A moved-aside database is a file with a name. A
moved-aside row needs somewhere to be -- a second table, or a report that
survives the restart that produced it. A log line the next restart overwrites
is not "kept aside", it is "mentioned once", and this tree has already paid
for the difference between a check that is red and a check that is read.
