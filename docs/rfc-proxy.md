# Proxy caller: CALL FUNCTION without DESTINATION

`tools/rfc-proxy.mjs`, spike P1. A `CALL FUNCTION 'X'` with no `DESTINATION`
whose module is **not transpiled** here may be forwarded to a destination,
recorded, and replayed later without the system. It is opt-in: without
`STG_RFC_PROXY` nothing changes and the call dumps with
`CX_SY_DYN_CALL_ILLEGAL_FUNC` as before.

## How

The transpiler emits the same two lines for static and dynamic calls: an
`abap.FunctionModules[NAME] === undefined` check (the dump), then
`await abap.FunctionModules[NAME]({exporting, importing, tables, changing})`.
`installFunctionProxy(abap, {destination, allow, mode})` replaces the table
with a Proxy over the original. A defined name is returned untouched; an
undefined name matching `allow` (exact names or `PREFIX*`) is a forwarder to
the client `clientFor` builds for the destination, so live, record and replay
use the one client and the one capture format of `docs/rfc-channel.md` /
`tools/rfc-replay.mjs`; any other name stays `undefined`.

The allow list is bounded on purpose: a bare `*` (every module) is refused.
A blank `DESTINATION` asks for local execution, so the proxy does not answer
it (nor `STARTING NEW TASK`): the runtime's `callFunction` reads the plain
table, and an absent module dumps there as before.

A call without DESTINATION has no EXCEPTIONS map in its parameters (the caller
catches a classic error and switches on its name), so the forwarder gives the
client a `raise(key)` that throws one; a captured or live classic exception
reaches the caller's `EXCEPTIONS name = n` as `sy-subrc`.

## Using it

    STG_RFC_PROXY=<destination>            turns it on
    STG_RFC_PROXY_ALLOW=Z_FOO,BAPI_FLIGHT_*  names that may be forwarded
    STG_RFC_PROXY_MODE=live|record|replay  default: the destination's entry in
                                           .local/rfc-destinations.json, else replay
    STG_RFC_CAPTURE=<folder>               capture folder (<folder>/<FM>/<n>.json)
    STG_RFC_NO_LIVE=1                      (or CI=true) live and record fall back
                                           to replay

`test/setup.mjs` wires it, Node only (the preview never installs it). With
`noLive` and no capture the forwarder throws, naming the module and the
capture path; it never answers empty.

## Seeing what was proxied

`proxyJournal()` returns `[{name, source, destination}]`, `source` being
`live`, `record` or `replay`; a transpiled module never appears in it.

## Local-ness

Anything asking "is this module transpiled" must not see the Proxy, or
`RfcFallbackClient` would take the forwarder for a local module. Use
`isLocal(name)` / `localFunctionModules()` from `tools/rfc-replay.mjs`; both
read the table the proxy wrapped (`localClient` and `RfcFallbackClient` do).

## Not proxied

A remote call carries parameters and results only. It does not carry
authority checks (they run on the other system, as its user), `COMMIT WORK`
(the remote LUW belongs to the remote system), ABAP memory (`EXPORT TO
MEMORY`), or enqueue locks. A module that depends on any of these needs a
transpiled replacement, not a proxy.

Tests: `test/rfc-proxy.mjs`, captures in `test/fixtures/rfc/Z_PROXY_PROBE_FM/`, probe class in `test/fixtures/rfc-proxy/` (synthetic).

## P2: tables

`tools/rfc-table-proxy.mjs`, spike P2. P1 forwards a function module that is
not transpiled; P2 does the same for **data**. A transparent table whose DDIC
is here (so it compiles and exists in the local database) and which has **no
rows here** is filled, on its first read in a process, from a system through
`RFC_READ_TABLE`. Opt-in: without `STG_TABLE_PROXY` nothing changes.

    STG_TABLE_PROXY=<destination>          turns it on
    STG_TABLE_PROXY_ALLOW=ZFOO,ZBAR_*      tables that may be filled
    STG_TABLE_PROXY_MAX_ROWS=1000          ROWCOUNT, default 1000
    STG_TABLE_PROXY_MODE=live|record|replay  default: STG_RFC_PROXY_MODE, else the
                                           destination's entry in
                                           .local/rfc-destinations.json, else replay
    STG_RFC_CAPTURE, STG_RFC_NO_LIVE, CI   as for P1

`test/setup.mjs` installs it after the database is built, Node only. The
allow list is exact names or a non-empty `PREFIX*`; a bare `*` is refused.
Recording and replay come with it: a read is a call of `RFC_READ_TABLE`
through the client of the destination, written as
`<capture>/RFC_READ_TABLE/<n>.json` in the format of `docs/rfc-channel.md`.
A replay takes the capture whose `QUERY_TABLE` is the table asked for (the
generic replay client falls back to the first capture of the module, which
here would be another table's rows). With `noLive`/CI and no such capture the
read is an **error naming the table and the capture path**, never an empty
table that looks hydrated.

### What is hydrated, and when

The proxy wraps the connection in `abap.context.databaseConnections.DEFAULT`
(the eleven-method `DatabaseClient` of `docs/db-backends.md`; the runtime is
not forked). A `select` or `openCursor` is read as SQL text, and **every
allow-listed table the statement mentions** as an identifier (outside string
literals and comments) is hydrated before it runs. This is an
over-approximation on purpose: an exact reading of `FROM`/`JOIN` missed a read
table in one more SQL form per review round (a comma after a `JOIN`, a derived
table in a comma list), and a missed table is a wrong answer, while a name
that is mentioned but not read (a column or alias sharing a table's name)
only costs an extra hydration of a table one is allowed to read. String
literals count as mentions too, since SQLite reads ``FROM `tab` `` and
`FROM 'tab'` as tables. The *first statement that mentions* a table is what
decides it: an alias or column that shares an allow-listed table's name
hydrates that table there, so a later local write meets the fetched rows
rather than an empty table (write-first applies to writes before any
mention). In replay without a capture such a mention fails the statement
with the capture path, never with an empty table. The exact
reading (`FROM`, `JOIN`, comma lists, `WHERE` subqueries, `UNION`; a `FROM`
inside `TRIM`/`EXTRACT`/`SUBSTRING` is not a table) is still done for the
journal: a statement it cannot classify (`WITH`, anything in parentheses right
after `FROM`/`JOIN`, a table function, `FROM @x`, a string where a table
should be) is journaled as `unclassified` with the reason, and its mentioned
allow-listed tables are hydrated all the same. For each allow-listed table the
statement reads and that has not been decided in this process:

1. it was written locally first and the write is **committed**: **not
   hydrated**, journal `skipped-written`. The mark follows the LUW: a write
   marks the table pending, a `commit` makes it local for good, a `rollback`
   drops the pending mark and any skip decided because of it, so the first
   read after the rollback can still hydrate. A write that failed (the client
   threw, or answered `subrc` other than 0) marks nothing;
2. it already has rows (seeded, restored from `STG_DB_PATH`): **not
   hydrated**, journal `skipped-local-rows`;
3. otherwise `RFC_READ_TABLE` with `QUERY_TABLE`, `DELIMITER` (`|`),
   `FIELDS` = the columns of the **local DDIC** (so they match; fields of type
   STRING/RAWSTRING/table are left out and stay NULL), `ROWCOUNT` = max rows;
   the rows are inserted, the table is marked, journal `hydrated`.

Then the original statement runs. A JOIN of two allow-listed tables hydrates
both. The table has to be in the local DDIC (`abap.DDIC`); an allow-listed
table that is not is an error, not a guess.

**Writes stay local.** `insert`, `update` and `delete` never go to the system.
A successful, committed one on an allow-listed table before its first read
makes it local for good (an `execute(sql)` is not looked at: seed before installing). The hydrated
rows are part of the **open LUW**: a `commit` keeps them; a `rollback` takes
them back, unmarks the table (journal `rolled-back`) and the next read fetches
again. If a row cannot be inserted (a duplicate key in the capture) the table
is emptied again and the read fails.

**MANDT.** The system's rows come with the system's client. The column MANDT
is rewritten to the local client, `sy-mandt`, which is 123 here, **only for a
client-dependent table**: one whose first key field is the client (typed with
the data element MANDT or, because the transpiled DDIC keeps no CLNT, a CHAR 3
called MANDT). A MANDT that is not the first key field, or any column of a
client-independent table, keeps the system's value (ANORMALIES
"no implicit MANDT": nothing filters by client, so a row left in another
client would be read anyway, and a DPC branching on `sy-mandt` would see
123). Any other client column is not touched.

**The row limit.** `ROWCOUNT` is `maxRows` (default 1000). A table with that
many rows or more is hydrated with the first `maxRows` and the journal says
`truncated: true`; there is no paging, so a table the program needs whole
must be raised or captured by hand. A replay cuts a longer capture to
`maxRows`, too.

`tableJournal()` returns `[{table, state, source, rows, truncated,
destination}]`, `state` being `hydrated`, `skipped-written`,
`skipped-local-rows`, `unclassified` or `rolled-back`, and `source` `live`,
`record` or `replay`.

### Parsing, and the limits of RFC_READ_TABLE

DATA is cut **by the offset and length of the FIELDS the system returns**,
not by the delimiter alone, so a value that contains `|` is intact. Where a
delimiter was asked for, it must stand right before every field after the
first, or the proxy stops ("the offsets of FIELDS are not the layout of DATA,
refusing to guess"). `DELIMITER` blank (option `delimiter`) asks for
fixed-width rows. Numbers: a trailing minus (`3.00-`) becomes a leading one,
then the runtime's own type converts, as it does for its own INSERT.

What is known, and from where:

- A DATA row is a `TAB512`, so a row is at most **512 characters**, delimiters
  included. From SAP documentation, not measured here. A table whose readable
  fields add up to more (DDIC lengths, an estimate) is refused before the call,
  naming the width; the real system's `DATA_BUFFER_EXCEEDED` would be the
  other signal. Nothing is split into column groups: rows of two calls cannot
  be paired without a key.
- DEC/CURR/QUAN values come back as text with a trailing sign, DATS as
  `YYYYMMDD`, TIMS as `HHMMSS`: from SAP documentation, and what the parser
  assumes; no formatting guarantee beyond that is taken for granted.
- The OFFSET column of FIELDS **counts the delimiters of DATA**: measured on
  the A4H sandbox (2026-10-01) by calling `RFC_READ_TABLE` on `T000` with
  `DELIMITER = '|'` and fields MANDT, MTEXT, ORT01: FIELDS came back as
  offsets 0 / 4 / 30 with lengths 3 / 25 / 25, and each DATA row had the
  delimiter at position 3 and 29 (`000|<25 chars>|<city>`); without a
  delimiter the row is the fields back to back. The parser's layout check
  (a delimiter before every field after the first) matches that, and the
  fake system and the captures of `test/fixtures/rfc/RFC_READ_TABLE/` are laid
  out the same way. The trailing blanks of the last field are not sent.
- `RFC_READ_TABLE` reads the logon client of a client-dependent table and is
  not remote-enabled everywhere; authority checks (S_TABU_DIS) run as the RFC
  user. Not proxied here, as in P1.

Tests: `test/rfc-table-proxy.mjs` (SQL reading as a table of cases, then the
behaviours above on the real transpiler and SQLite), captures in
`test/fixtures/rfc/RFC_READ_TABLE/`, probe class and three synthetic tables in
`test/fixtures/rfc-table-proxy/`.
