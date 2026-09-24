# A dynamic WHERE, as the kernel reads it

`SELECT ... WHERE (lv_where)` takes a condition an ABAP program built as a
string at run time. Four producers in this tree build one: the request
context's `get_osql_where_clause` (select-options of a `$filter`), the SADL
DPC's key and navigation conditions, open-abap-odata's search-help reader,
and SE16 (`zcl_osd_se16`, `where_of` / `option_of`, free input into a
column of any type). All four write the same small language: a column, a
comparison, a quoted literal with `''` for a quote, `[NOT] BETWEEN`,
`[NOT] LIKE`, `NOT ( ... )`, AND, OR, parentheses. No producer writes a
host variable.

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

### Second round, after the critic on #47

| `lv_w` | rows, or what was raised |
| --- | --- |
| `seatsmax = '385.0'`, `'+385'` | 18 each |
| `carrid = 'AA' AND seatsmax = '384.5'` / `'385.4'` | 6 / 6: rounded to 385, half away from zero |
| `seatsmax = '1.5'` | 0 |
| `seatsmax = '385-'` | 0: a trailing minus, -385 |
| `seatsmax = ''` | 0: the empty text is 0, no error |
| `seatsmax > -5` (unquoted) | 94 |
| `seatsmax = '1e3'`, `seatsmax = '99999999999'` | uncatchable runtime errors |
| `carrid = 'AA' AND price = '422.944'` / `'422.935'` | 6 / 6: rounded to 422.94 |
| `carrid = 'AA' AND fldate = '20161115000000'` | 1: cut to the date's eight characters |
| `carrid = 'AA' AND fldate = '2016-11-15'` | 0, no error: cut, not read as a date |
| `carrid='AA'` | `CX_SY_DYNAMIC_OSQL_SYNTAX`: an operator stands between blanks |
| `carrid IS INITIAL` | `CX_SY_DYNAMIC_OSQL_SEMANTICS` |
| `carrid = @lv_out` | `CX_SY_DYNAMIC_OSQL_SEMANTICS` (the statement has no `@`) |
| `carrid LIKE 'A%' ESCAPE '%'` | `CX_SY_DYNAMIC_OSQL_SEMANTICS` |
| `` carrid = `AA` `` | 6: a backtick literal is read |
| `carrid LIKE 'AA '` / `'AA'` | 6 / 6: a trailing blank in a pattern on CHAR is dropped |

One difference from a ranges table (`tools/ir-ranges.mjs`), the other way
ABAP hands a condition over: a ranges value longer than the column raises
`CX_SY_OPEN_SQL_DATA_ERROR`, where a literal here is cut to the column's
length. Otherwise a literal is converted as a ranges value is bound: CHAR
right-trimmed, NUMC zero-padded, an INTEGER as a number.

## What the parser does with it

Everything in the tables above, with the same outcome. A kernel exception
class is named only where A4H raised it (`OsqlWhereSyntax`,
`OsqlWhereSemantics`; `OsqlWhereDump` for the uncatchable ones); anything
else the parser cannot read is refused with a reason from the closed list
`REASONS`, never with a class it was not seen to raise. In particular:

- a number is converted as ABAP converts text to a number (`abapNumber`):
  spaces around ignored, empty is 0, a sign leading or trailing, rounded half
  away from zero to the column's decimals; a letter or a value past INT4
  (or past a packed column's `2 * len - 1` digits, by the same rule,
  not measured separately) is a dump; any other shape (a sign on both sides)
  is refused as a number format not measured. An INTEGER is inlined after
  that range check; a packed value is bound as a decimal string, never a
  JavaScript number;
- a date column is CHAR 8: the literal is cut, not read;
- a quoted literal into a STRING column drops its trailing blanks, as ABAP's
  conversion from C to STRING does, and a backtick literal keeps them -- the
  rule, not a measurement: SFLIGHT has no STRING column;
- blanks are space, tab, CR and LF; a no-break space is not one;
- a character outside the Basic Multilingual Plane is refused, as it is in
  a SQLScript variable; a CHAR literal is cut in UTF-16 code units;
- nesting deeper than 256, or more than 2000 comparisons, is refused
  ("too deep"): past that a recursive parser or lowering runs out of stack,
  and a port with a growing stack would answer where this one fails.

Refused by name and not carried: a host variable (a system reads one; no
producer here writes one), a column compared with a column, a qualified
name (`tab~col`), an unquoted number against a CHAR column, a NUMC literal
that is not digits within the column's length, LIKE on anything but a CHAR
column, and TIME or RAW columns.

## What the measurement found in the producers

- **`1 = 1` is refused by the kernel.** The generated `zcl_stg_tab_*` and
  `zcl_stg_cds_*` sources (`tools/cds2ddic.mjs`) put `'1 = 1'` in place of an
  empty condition, which raises `CX_SY_DYNAMIC_OSQL_SEMANTICS` on a system
  (fixed in #48); open-abap-odata's search-help reader does the same
  (`zcl_oao_shlp_ddic`, an upstream fix). An empty string is already "no
  condition" there.
- **The request context gets precedence wrong.** `get_osql_where_clause`
  chains a property's select-options as `a OR b AND NOT ( c )`, which the
  kernel reads as `a OR ( b AND NOT c )`: an exclusion applies to the last
  inclusion only, and an inclusion after an exclusion is OR-ed to it
  (`$filter=Project ne 'X' and Project eq 'X'` returned the row). Its
  `WHEN OTHERS` also turns NB and NP into `=`. Fixed in #49. The search-help reader in open-abap-odata writes
  `( a OR b ) AND NOT c AND ...`, which is the meaning of a select-options
  table.
- The CP conversion in both (`*` to `%`, `+` to `_`) does not escape a
  literal `%` or `_` in the value (`substringof('50%',Project)` sends
  `LIKE '%50%%'`); `tools/ir-ranges.mjs` has the rule (`#` escapes,
  `ESCAPE '#'` when needed).
