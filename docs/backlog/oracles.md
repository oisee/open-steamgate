
## Track O — the oracles: proving we answer the way a system answers

*Proposed 2026-09-18 by the workstation session, which owns the formulation.
These two lived nowhere: they were proposed in conversation, nobody answered,
and so they were not written down. The instrument has outgrown a single
track — today it compares frames, tomorrow SQL, the day after steps.*

O.0  A frame as the oracle — **exists already**                          [S]
     `tools/o4d-record.mjs --scene <name> --ticks n` on both sides plus
     `--compare` names the ABAP that computed a difference. Eight anomalies
     in two days, 2026-09-16/17, each then measured on A4H with a throwaway
     ABAP Unit probe before anything was changed. It is listed here so the
     next two are written as its siblings and not from scratch.

O.1  An SQL trace taken on both sides, compared              [S]  high, first
     ├─ take an SQL trace of one service call on A4H (ST05, or the trace
     │  from ADT — both reachable through vsp), take ours, bring both to a
     │  canonical form (statement text with the literals masked, order
     │  preserved) and compare
     ├─ **our side is nearly free, and that is the argument for doing it
     │  first**: all transpiled ABAP talks to exactly one object,
     │  `abap.context.databaseConnections["DEFAULT"]` with its eleven
     │  methods (docs/db-backends.md), so there is one interception point
     │  and no new protocol on either side
     ├─ what it catches that the OData surface cannot show at all: a
     │  missing MANDT, a different ORDER BY, an N+1 where the system issues
     │  one statement, a different FOR ALL ENTRIES chunking
     └─ the deeper reason for the priority: the database seam is the one
        place where being wrong is **invisible from outside**, because the
        answer can come out right by accident

O.2  A step trace through the debugger endpoints             [S]  after O.1
     ├─ drive a DPC step by step through the debugger endpoints on A4H,
     │  recording (statement, variable snapshot) pairs; run the same here
     │  through a runtime hook; compare and name the first step that
     │  diverges
     ├─ an order of magnitude more expensive than O.1, because it needs the
     │  live debugger protocol
     └─ **its message schemas are the same as A.6's** and the two are
        written together — A.6 answers those endpoints, O.2 calls them. See
        the note on A.6

O.3  An AMDP method as the oracle, on three sides            [S]  near-term
     *Proposed by Alice 2026-09-19, after the day's HANA work made all
     three sides reachable at once.*
     ├─ one AMDP body, three answers: **A4H** (a real system computing it
     │  natively), **HANA Express** (real SQLScript, our deployment and our
     │  destination), and **transpiled** (our own reading of the body).
     │  `tools/amdp-record.mjs --method <cls=>meth> --case <name>` writes a
     │  record per side, `--compare` names the side that answered
     │  differently -- the shape of O.0, which already works
     ├─ **why three and not two, which is the whole point**: today a
     │  divergence between a real system and us does not say whether our
     │  *translation* or our *deployment* is wrong. A4H against HXE tests
     │  the deployment -- procedure creation, DDIC-to-HANA types, the
     │  destination. HXE against transpiled tests the reading of the body.
     │  Two sides conflate two error sources; three separate them in one run
     ├─ the object suits it: an AMDP method is usually a pure function of
     │  its input tables, so there is no screen state and no session to
     │  reproduce -- values in, values out
     ├─ **the third column is mostly empty on purpose.** There is no
     │  SQLScript-to-Open-SQL translator and Alice ruled one out as too
     │  large (2026-09-19). It fills only where the method has an ABAP twin
     │  -- written by hand for the demo, or present in foreign code behind a
     │  `cl_abap_dbfeatures` branch. Everywhere else it records **"not
     │  attempted"**, a third value and not a zero, or the count reports as
     │  successes the runs nobody made
     ├─ needs the masking discipline of `compareTraces`: the transpiler's
     │  fixed `sy-mandt = 123`, `sy-sysid = ABC` and UTC differ from A4H's,
     │  and without masking half the rows diverge for no reason. The verdict
     │  kinds of `tools/sqlscript-vs-hana.mjs` (`same-values-different-scale`,
     │  `different-rows`, `both-raised`) apply unchanged
     ├─ calibration first, before any comparison is believed: **a side
     │  against itself must produce an empty diff.** If it does not, the
     │  normalisation is lying and nothing built on it can be trusted
     ├─ A4H only when Alice asks, per the standing rule; recordings under
     │  `.local/`, never tracked
     └─ **what it buys upstream, which is the reason it is near-term**:
        HANA Express is a 4.5 GB image wanting 8-16 GB, so abaplint's own CI
        cannot run it, and any AMDP contribution has to say "you cannot
        verify this here". This oracle is the honest answer to that: not
        "trust us" but "here is one body answering the same on a real
        system and on ours, and here is precisely where it does not".
        Divided 2026-09-19: the oracle's construction, the HXE column and
        the A4H round are osg-osd-i7's; the seeding half that had to be
        fixed before the HXE column means anything was this session's, and
        is done (`STG_DB_FRESH` per run, and the LUW that `execute` never
        opened)

---
