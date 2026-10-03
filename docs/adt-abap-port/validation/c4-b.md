# C4 data preview on the B1/B2 serving runtime

Base: `cc6b0287a9803494caae8b1eeb363fbfe3a75f58`. Reference C4 was read,
not merged or cherry-picked. Five registrations move when the serving-child
STORE binding has local SYSTEM answers: freestyle POST, DDIC metadata GET
(with HEAD), DDIC POST, CDS metadata GET (with HEAD), and CDS POST.
The environment switch alone cannot mount these routes in a parent kernel
or an inline host. Switch-off preview retains Node's Data / `/osd/sql` path.

No new STORE commands. PARSE gains DDLS in the existing PARSE_KINDS table;
OUTLINE, BOGUS and empty kinds retain `unknown PARSE kind` refusals.
SQL and SQLCHECK remain SYSTEM kinds answered locally, never parent STORE
commands. Preview uses IV_JSON / EV_JSON; `rawMessage` avoids SYSTEM's
pre-existing `raw` / EV_SOURCE convention. Non-preview SYSTEM SQL calls keep
B2's original row envelope.

The shared cell module preserves Node's formatting. ABAP renders the XML
and keeps the supplied column, cell, field and CDS element order. B8b's
DDIC class retains its document routes and TABLE_FIELDS API; preview opts
into data-element/domain resolution through the retained ELEMENT. Its
READ TABL then VIEW wrapper and field mapping live in the preview class.
Malformed length text stays a string, including NaN.

Preview reads use SQLite savepoints, DuckDB's LUW replay, or the active
PostgreSQL transaction client's savepoint. PostgreSQL syntax checking uses
its existing separate physical prepare session. Routes never commit or
roll back. No lockedClient or nested dialog step is used for child SQL.

Validation (all through `OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh`):

- SQLite C4 suites: 109 passing, including two PostgreSQL client-fake tests
  and the two real serving-child/switch-off tests.
- DuckDB C4a/C4b: 105 passing.
- ADT diff, coverage, XML and STORE destination gates: 127 passing.
- Default-profile coverage: 11 passing; the gate samples the complete
  child-binding table, and switch-off compatibility is tested separately.
- ABAP Unit: 16 method executions per engine across TABLEDATA, FREESTYLE,
  PREVIEW and reused DDIC, HOST, CHECKREPORT (included in the C4 runs).
- Five renderer mutations are caught by the byte-diff gate, one for each
  registration. Comparisons assert ABAP ownership, normalize only the
  variable execution-time text, check real content length, and strip an
  empty trailing query marker in served-by comparisons.
- The real child diff covers all five registrations and blocks parent
  reads of the application table, proving that preview reads the serving DB.
- Failed SELECT and SQLCHECK preserve a newly pending session row on both
  SQLite and DuckDB. The PostgreSQL fake models an aborted transaction and
  confirms rollback-to-savepoint before the next session SELECT.
- 120 fields: 241 READs (TABL + DTEL and DOMA per field), approximately
  18-25 ms locally, about 0.15-0.21 ms/field. No resolver cache is claimed;
  a production wide-table request pays IPC for those reads.
- ABAP lint: no errors or C4 warnings; 72 existing warnings elsewhere.

Go parity is out of scope: osgo does not mount ADT. New route host work
checks require(SYSTEM) or require(PARSE), which Go's COMMANDS does not offer.
No Go implementation was added. PostgreSQL was tested through the actual
OsdPostgresClient with a fake physical client/pool, not a live server.
No full suite, push, publication or live system access was performed.
