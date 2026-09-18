# The transactional buffer

Backlog B.2. What holds changes until they are saved, and what a reader sees
while they are held.

## Why it is a level of its own, and not "a draft without persistence"

A buffer and a draft look alike from outside — both hold changes that are not
in the database yet — and treating them as one thing with two lifetimes is the
mistake that makes the draft a rewrite. They are two levels:

- **the buffer** lives exactly one LUW. `modify` collects, the save sequence
  runs — determinations, validations, then the write — and only then do rows
  reach the database.
- **a draft** lives *between* requests, in a table of its own, and is
  activated by an action. That activation **runs in the buffer**, because
  activating re-runs the behaviour.

So a draft stands on a buffer rather than replacing it. Fold them together and
there is nowhere for the save sequence to happen, which is a thing you find
out at the first validation rather than at design time.

What carries between them is the **delta**: entity, key, operation, the row
after. It is serialisable from the first day, so persisting it later is a
change of storage and not of model — and the merge of delta with active data
is written **against the delta**, never against the storage, or it has to be
written twice.

## What it holds

`ZIF_OSD_LUW`, implemented by `ZCL_OSD_LUW`:

```abap
mi_luw->modify( iv_entity = 'Travel' iv_key = 'T1' iv_operation = 'C' ir_row = lr_row ).
mi_luw->operation_of( iv_entity = 'Travel' iv_key = 'T1' ).   " C / U / D, or initial
mi_luw->row_of( iv_entity = 'Travel' iv_key = 'T1' ).
mi_luw->delta( ).                                             " in the order recorded
```

The key is the entity's key **rendered as text**, which is what lets two
changes to the same row be recognised without the buffer knowing the row's
type. The row itself travels as `REF TO data`.

## Collapsing, which is the whole job

Collecting changes is not the hard part; collapsing two changes to the same
row is. Each of these would be wrong if the buffer simply appended:

| first | then | held as | why |
| --- | --- | --- | --- |
| create | update | **create**, later row | saving it as an update finds nothing to update |
| create | delete | **nothing** | the row never existed |
| update | delete | **delete** | |
| **delete** | **create** | **update**, new row | the row ends up present and different |

The last one is the one that is easy to get wrong, and it is the reason this
has tests before it has callers. A delete followed by a create of the same key
is not two changes to replay: replaying them would delete what had just been
written. It is one row that is there, with new content.

A create stays a create however often it is updated afterwards. Everything
else takes the later operation.

## What is not built yet

- **The save sequence.** `delta( )` gives the changes in order; nothing yet
  runs determinations or validations over them, and nothing writes them.
- **Reading through the buffer.** `operation_of` and `row_of` are the two
  answers a reader needs, but the SADL DPC does not consult them yet, so a
  read still goes straight to the database.
- **Draft.** The delta is shaped for it; the table and the activation action
  are not written.
