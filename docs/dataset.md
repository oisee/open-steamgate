# OPEN DATASET: files, behind a sandbox (X0)

ABAP reads and writes files with `OPEN DATASET`, `READ DATASET`, `TRANSFER`,
`CLOSE DATASET`, `DELETE DATASET`, `GET DATASET` and `SET DATASET`. The
transpiler emitted every one of them as `throw new Error("... not supported")`.
Now they run, split in two:

- **The runtime owns the ABAP.** Text lines and their end, the byte layout of
  each mode, ACTUAL LENGTH and MAXIMUM LENGTH, sy-subrc, the table of open
  files, CX_SY_FILE_OPEN and CX_SY_FILE_OPEN_MODE live once in the
  transpiler's runtime (`packages/runtime/src/statements/dataset.ts`, pinned
  locally on `oisee/transpiler`, upstream PR in the backlog; ANORMALIES
  `dataset-not-supported`).
- **The host owns the disk.** `abap.context.dataset` opens a name and reads
  and writes bytes at a position -- the way a `DatabaseClient` answers SQL.
  `tools/osd-dataset.mjs` is that host, and `test/setup.mjs` installs it for
  the server, the unit run and the binary; the browser preview gets a file
  system in memory.

## The sandbox

Nothing is readable or writable until a root says so:

| variable | meaning |
|---|---|
| `OSD_DATASET_READ` | directories a program may read, separated by `:` (`;` on Windows) |
| `OSD_DATASET_WRITE` | directories it may write, create and delete in; readable too |
| `OSD_DATASET_HOME` | where a relative name resolves; default the first write root that exists, else the first read root |
| `OSD_DATASET_AUDIT` | a file that gets one JSON line per OPEN and DELETE, allowed or not |

Three checks stand between a name and the disk, because each alone was not
enough:

1. The name as written must lie inside a root before anything is looked up,
   so a refusal never tells a program which directories exist elsewhere.
2. The name is resolved to its real path -- `..` and symlinks followed -- and
   compared with the roots' real paths as directories (`/data/in2` is not
   inside `/data/in`). A last component that is a symlink pointing nowhere is
   refused: opening it for writing would create the file at the link's
   target, wherever that is (the critic reproduced exactly that).
3. The open and the unlink resolve the path beneath the root in the same
   call that acts on it, so a parent directory swapped for a symlink between
   the checks above and the open cannot take a create, a truncate or an
   unlink outside. On Go every root is an `os.Root`, held from the first
   use, and each OPEN and DELETE goes through the one that holds the path
   (`openat` one component at a time with `O_NOFOLLOW` on Linux,
   `O_NOFOLLOW_ANY` on Windows). Node has no `openat`, so on Linux the
   host walks down from the root one directory at a time, opening each as
   `/proc/self/fd/<parent>/<name>` with `O_NOFOLLOW | O_DIRECTORY`, and
   creates or unlinks the last name relative to the last directory it holds;
   a swapped directory fails its step and the open is refused. Both hosts
   have a test that swaps the directory at exactly that moment and checks
   that nothing appeared or disappeared outside; before this change the
   create landed outside and was only refused afterwards.

FOR OUTPUT truncates only after the open. DELETE removes the entry the
program named -- a link, not what it points at -- and a link that points out
of the roots is not deleted at all.

Where Node has no `/proc/self/fd` (macOS, Windows, a Linux without `/proc`
mounted) the lexical and real-path checks stand alone and that race is open;
on Windows root comparison is also case-sensitive although the file system
is not, not verified there. Treat a Node host off Linux as checked, not
sandboxed. The Go host holds the root directories open from the first use;
Node opens the root again for each call, with `O_NOFOLLOW`, and refuses when
the descriptor did not land on the root's real path, so a root renamed and
replaced by a link meanwhile is refused too. The sandbox is a guard for
programs; the race is closed because it cost little, not because a local
attacker is the model.

A refused or failed OPEN reports the reason without the resolved path; the
audit log has the path.

A refusal is what a system answers when a file cannot be opened: sy-subrc 8
and the reason in `MESSAGE`. A system's own authority check raises
CX_SY_FILE_AUTHORITY instead; that could not be measured (the probe user has
every authority), so the sandbox keeps the shape that was measured
(ANORMALIES `dataset-authority`).

```
OSD_DATASET_READ=$PWD/in OSD_DATASET_WRITE=$PWD/out npm start
```

## What the statements do

Measured on A4H on 2026-09-30 with throwaway ABAP Unit probes (one by dell,
one by stoker), before any line was written:

| case | answer |
|---|---|
| TEXT MODE TRANSFER of `c(10)` 'ab' | `61 62 0A`: a C field loses its trailing blanks, a string keeps them |
| TEXT MODE, `LENGTH 3`, `NO END OF LINE` | the first 3 characters; no LF |
| ENCODING DEFAULT | UTF-8 |
| TEXT MODE READ | one line per READ without its LF; a CR before it stays; the last line needs no LF; then sy-subrc 4 and the target cleared |
| READ into `c(5)` of 'longer line' | 'longe', ACTUAL LENGTH 11, the whole line consumed |
| BINARY MODE TRANSFER of `c(4)` 'ab' | `6100 6200 2000 2000`: UTF-16LE, the full length |
| BINARY MODE READ into `x(3)` of 5 bytes | 3 bytes rc 0; then 2 bytes rc 4 padded with 00, ACTUAL LENGTH 2; then rc 4, 0 |
| BINARY MODE READ into a string | the rest of the file, UTF-16LE; ACTUAL LENGTH in bytes |
| TEXT MODE READ into an `x` field | an uncatchable runtime error on the system; an Error here |
| missing file FOR INPUT | sy-subrc 8, MESSAGE 'No such file or directory' |
| READ on a file opened FOR OUTPUT or APPENDING | sy-subrc 4 |
| READ or TRANSFER on a file not open, TRANSFER on one opened FOR INPUT | CX_SY_FILE_OPEN_MODE |
| OPEN of an open file | CX_SY_FILE_OPEN |
| CLOSE of a file not open | sy-subrc 0 |
| DELETE of a missing file / of an open one | 4 / 0, and the open one is closed |
| FOR APPENDING / UPDATE / OUTPUT | at the end / at 0 without truncating, a missing file is 8 / truncating |
| SET DATASET POSITION 0, END OF FILE | reread / position = size, READ rc 4 |

Refused by name rather than ignored: LEGACY and NON-UNICODE, CODE PAGE,
TYPE, FILTER, IGNORING CONVERSION ERRORS, byte-order marks, linefeed
options, MAXIMUM LENGTH in TEXT MODE, GET DATASET ATTRIBUTES; a structure or
a number as the field. TRUNCATE DATASET and SORT still throw.

## Go

`tools/gogen/go/abap/dataset.go` is the same runtime and the same sandbox
over the same variables, and gogen lowers the seven statements to it
(`frontend.mjs` `datasetStatement`, `emit-go.mjs`). The semantics harness
runs `ZCL_GOGEN_T_DATASET` in a temporary write root and compares it with
the answers A4H gave; the JS backend of gogen has no file system and says
so (NOT_COMPILED). An embedding program can also install a host of its own
with `abap.SetDatasetHost`.

## Not yet

- osabap: the report converter of open-abap-gui does not pass the DATASET
  statements through yet, so a report that uses them is refused before
  gogen sees it; `--allow-read` / `--allow-write` will set the two roots
  (track O).
- TRUNCATE DATASET, SORT, the additions refused above.
