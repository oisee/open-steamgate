# A dynamic WHERE, as the kernel reads it

`SELECT ... WHERE (lv_where)` takes a condition an ABAP program built as a
string at run time. Three producers in this tree build one: the request
context's `get_osql_where_clause` (select-options of a `$filter`), the SADL
DPC's key and navigation conditions, and open-abap-odata's search-help
reader. All three write the same small language: a column, a comparison, a
quoted literal with `''` for a quote, `[NOT] BETWEEN`, `[NOT] LIKE`,
`NOT ( ... )`, AND, OR, parentheses. No producer writes a host variable.

The transpiler pastes the string into the SQL text as it stands. That is an
ABAP condition handed to an engine that speaks another dialect, with every
literal in the statement text instead of bound. `tools/ir-osql-where.mjs`
parses it into IR instead, against the columns of the table read, and the
Go backend ports the parser and checks it against
`test/fixtures/ir-pairs/osql-where.json` (`tools/ir-osql-where-pairs.mjs`).

## Measured on A4H

2026-09-24, `SELECT COUNT(*) FROM sflight INTO lv_n WHERE (lv_w)` through
`execute_abap`, nothing created. SFLIGHT holds 94 rows; CARRID is CHAR3,
CONNID NUMC4, SEATSMAX INT4, PRICE CURR 15,2.

| `lv_w` | rows, or what was raised |
| --- | --- |
| `` (empty) | 94: no condition |
| `carrid = 'LH'` | 32 |
| `CARRID = 'LH'`, `Carrid = 'LH'` | 32: a column name is case-insensitive |
| `carrid = 'lh'` | 0: a literal is not |
| `carrid LIKE 'l%'` / `'L%'` | 0 / 32: nor is LIKE |
| `carrid = 'LH X'` | 32: the literal is cut to CHAR3 (`'LH '`) |
| `carrid = 'LHXX'` | 0 (`'LHX'`) |
| `carrid = 'L''H'` | 0, no error: `''` is a quote |
| `seatsmax = '385'`, `seatsmax = 385` | 18 each: a quoted number is the number |
| `seatsmax = 'abc'` | an uncatchable runtime error: the test run ends with nothing reported |
| `connid = '400'`, `connid = '0400'`, `connid = 400` | 8 each: NUMC is zero-padded |
| `price > '500.5'` | 74 |
| `carrid = 'LH' OR carrid = 'AA' AND seatsmax > 300` | 38 = 32 + 6: AND binds tighter than OR |
| `( carrid = 'LH' OR carrid = 'AA' ) AND seatsmax > 300` | 30 |
| `NOT carrid = 'LH'` | 62: NOT takes the one condition after it |
| `carrid <> 'LH'`, `carrid EQ 'LH'` | 62, 32 |
| `carrid != 'LH'` | `CX_SY_DYNAMIC_OSQL_SYNTAX` |
| `carrid = ` | `CX_SY_DYNAMIC_OSQL_SYNTAX` |
| `nosuch = '1'` | `CX_SY_DYNAMIC_OSQL_SEMANTICS` |
| `1 = 1` | `CX_SY_DYNAMIC_OSQL_SEMANTICS` |
| `carrid IN ('LH','AA')` | 38 |
| `carrid NOT LIKE 'L%'` | 62 |
| `carrid LIKE 'L_'` / `carrid LIKE 'L#_' ESCAPE '#'` | 32 / 0 |
| `connid BETWEEN '0000' AND '0400'` / `NOT BETWEEN` | 38 / 56 |
| `carrid IS NULL` | 0 |
| `carrid = lv_c` (a variable of the program, `'LH'`) | 32: a host variable is read |

One difference from a ranges table (`tools/ir-ranges.mjs`), the other way
ABAP hands a condition over: a ranges value longer than the column raises
`CX_SY_OPEN_SQL_DATA_ERROR`, where a literal here is cut to the column's
length. Otherwise a literal is converted as a ranges value is bound: CHAR
right-trimmed, NUMC zero-padded, an INTEGER as a number.

## What the parser does with it

Everything in the table above, with the same outcome, and the error classes
named as the kernel names them (`OsqlWhereSyntax`, `OsqlWhereSemantics`;
`OsqlWhereDump` for the uncatchable one). Refused by name and not carried:
a host variable (a system reads one; no producer here writes one), a column
compared with a column, a qualified name (`tab~col`), an unquoted number
against a CHAR column, and a NUMC literal that is not digits within the
column's length. Of these only the host variable was measured, and it is
refused because nothing here writes one, not because a system refuses it.

## What the measurement found in the producers

- **`1 = 1` is refused by the kernel.** The generated `zcl_stg_tab_*` and
  `zcl_stg_cds_*` sources (`tools/cds2ddic.mjs`) put `'1 = 1'` in place of an
  empty condition, which raises `CX_SY_DYNAMIC_OSQL_SEMANTICS` on a system.
  An empty string is already "no condition" there.
- **The request context gets precedence wrong.** `get_osql_where_clause`
  chains a property's select-options as `a OR b AND NOT ( c )`, which the
  kernel reads as `a OR ( b AND NOT c )`: an exclusion applies to the last
  inclusion only. The search-help reader in open-abap-odata writes
  `( a OR b ) AND NOT c AND ...`, which is the meaning of a select-options
  table.
- The CP conversion in both (`*` to `%`, `+` to `_`) does not escape a
  literal `%` or `_` in the value; `tools/ir-ranges.mjs` has the rule
  (`#` escapes, `ESCAPE '#'` when needed).
