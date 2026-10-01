# Native ABAP report commands (OSABAP)

Status: working spike on `spike/osabap-app`, 2026-09-29.

OSABAP turns one classic executable ABAP report into a small native command.
The command preserves the report lifecycle and exposes the same selection
screen through three frontends:

| Invocation | Frontend | Intended use |
| --- | --- | --- |
| `osabap` | terminal form/TUI | interactive local use |
| `osabap [values and flags]` | headless CLI | scripts, pipes and CI |
| `osabap -sapgui` | real SAP GUI over NI/DIAG | classic desktop interaction |

This is deliberately not the OSGo application server. The generated command
does not contain HTTP, OData, Fiori or SQLite. It is built with the
`nodatabase` tag; reaching Open SQL produces an explicit host error.

## Build one report

The checked-in example is `tools/gogen/apps/hello/zhello.prog.abap`:

```abap
REPORT zhello.

PARAMETERS p_name TYPE c LENGTH 30 DEFAULT 'world' LOWER CASE.
PARAMETERS p_loud AS CHECKBOX.
SELECT-OPTIONS s_tag FOR p_name.

START-OF-SELECTION.
  IF p_loud = abap_true.
    TRANSLATE p_name TO UPPER CASE.
  ENDIF.
  WRITE: / 'Hello', p_name.
  WRITE: / 'Tags', lines( s_tag ).
```

Build it for the current platform:

```sh
node tools/gogen/osabap.mjs tools/gogen/apps/hello/zhello.prog.abap
# tools/gogen/.out/osabap
```

Cross-compile it for Windows 11 ARM in Parallels:

```sh
GOOS=windows GOARCH=arm64 \
  node tools/gogen/osabap.mjs tools/gogen/apps/hello/zhello.prog.abap
# tools/gogen/.out/osabap.exe
```

The builder performs this pipeline:

```text
zreport.prog.abap
  -> open-abap-gui report converter
  -> generated lifecycle class + helper classes
  -> gogen typed IR
  -> generated Go for the report and its small runtime closure
  -> go build -tags nodatabase -trimpath -ldflags "-s -w"
  -> one native executable
```

The report converter supplies the report lifecycle; gogen compiles the
converted ABAP and the selected open-abap-core/frontend classes. The generated
`zz_app.go` records the report name, selection names, positional order,
checkboxes and select-options. No ABAP source parser runs in the resulting
binary.

The build currently uses the repository's local open-abap-gui and
open-abap-core checkouts, as do the other focused gogen tools.

## One lifecycle, three input surfaces

All frontends eventually build
`ZIF_GG_SELECTION_SCREEN_TYPES_V1=>TY_VALUE` rows and call the same
`ZCL_GG_HOST=>RUN` entry point.

The first host call uses `present = abap_true`. It runs initialization and the
selection-screen lifecycle and returns a host-neutral snapshot:

- elements: parameters, checkboxes and select-options;
- current/default values;
- field labels and visible lengths;
- messages and screen state.

After the frontend collects values, the second host call uses function code
`ONLI`. It applies those values, executes the selection-screen events and
`START-OF-SELECTION`, and returns messages plus classic `WRITE` lines.

This is the native equivalent of supplying a selection table to `SUBMIT ...
AND RETURN`: the report is not rewritten as a separate command-line program.

## Two namespaces: report options and host flags

The command line has two namespaces that never meet (Alice, 2026-09-30):

- **Two dashes are the report's.** The selection screen is the command's
  interface: `--name Bob`, `--s-tag a --s-tag b`, `--loud` for a checkbox,
  and each field also by its full name (`--p-name`, `--s-tag`). A value may
  start with a dash (`--num -5`). After a bare `--`, everything is positional.
- **One dash is the host's:** `-db FILE`, `-params JSON|@file`, `-allow-read DIR`,
  `-allow-write DIR`, `-dataset-home DIR`, `-dataset-audit FILE`,
  `-sapgui[=ADDR]`, `-sapgui-no-launch`, `-help` (or `-h`).

A report with `PARAMETERS p_db` has its own `--db` next to the host's `-db`,
and a flag the host gains later cannot take a name away from a report that
is already built. Errors name the way out:
- `-5` alone asks for `--name -5`;
- `--help` points to `-help`;
- an unknown `--x` lists the report's options, and an unknown `-x` lists the
  host's flags.

For one release, the old double-dash spelling of a host flag (`--db`,
`--allow-read`, ...) is still accepted, with a line on stderr, as long as the
report has no option of that name. The reader and the one list of host
flags (`reportargs.HostFlags`) are in `tools/gogen/go/reportargs`; `osd run`
passes its arguments to the report binary untouched, so nothing else parses
them.

## Headless CLI

For `ZHELLO`, these are equivalent inputs:

```sh
osabap Alice --loud --s-tag one --s-tag two
osabap --name Alice --loud --s-tag one --s-tag two
osabap -params '{"P_NAME":"Alice","P_LOUD":true,"S_TAG":["one","two"]}'
osabap -params @arguments.json
```

Rules:

- ordinary parameters become positionals in declaration order;
- a parameter accepts both `--p-name` and its short form `--name`;
- a bare checkbox flag means `X`;
- repeated select-option flags become `I/EQ` range rows;
- JSON range objects may specify `sign`, `option`, `low` and `high`;
- `BT` is inferred when a JSON range has `high` but no `option`;
- explicit flags win over values from `-params`;
- unknown flags and excess positionals fail instead of being ignored.

Supplying any report argument selects headless mode. Output lines go to stdout,
messages go to stderr, an unsupported runtime operation exits with status 2,
and a runtime failure exits with status 1.

## DATASET file access

`OPEN`, `READ`, `TRANSFER`, `CLOSE`, `DELETE`, `GET` and `SET DATASET` use the
native dataset sandbox. With no access flags, every open is refused with
`sy-subrc = 8` and a `MESSAGE` reason, even if the parent process has dataset
environment variables set. Grant only the directories a report needs:

```sh
osabap -allow-read ./input -allow-write ./output --input ./input/source.txt --output ./output/copy.txt
```

`-allow-read DIR` and `-allow-write DIR` repeat to add roots, one directory
per flag. A write root
also permits reads. `-dataset-home DIR` resolves relative DATASET names from
that directory; otherwise the first write root, then the first read root, is
the base. `-dataset-audit FILE` appends JSON lines for OPEN and DELETE decisions
only when FILE is inside a write root; an outside path creates no audit file.
Relative audit names use the same base as relative DATASET names.
Each option accepts either `--option value` or `--option=value`. Paths outside
the granted roots, including `..` escapes, are refused. These flags govern
DATASET statements; frontend service file methods have their own host API.

## Classes of a report, and --lib

The classes and interfaces beside the report file (`zcl_x.clas.abap`, with its
local includes) are compiled with it, the same way its dictionary is:
`tools/gogen/apps/greet/` is the sample. Classes kept elsewhere come in with
`--lib <folder>`, repeatable, for example the zip reader of this tree:

```sh
node tools/gogen/osabap.mjs my/zreport.prog.abap --lib src/zip
```

Every class and interface in a `--lib` folder is compiled into the command.

The open-abap-core classes the program names come in by themselves: every
name in the report, its classes and its `--lib` folders that is a class or an
interface of open-abap-core is compiled, and so is every one those name in
turn, local classes included, until nothing new turns up. A static call is
not followed into the core the way a class of the program is, so without this
a report reading XML needed `CL_SXML_STRING_READER`, the node classes its
parser creates and `CL_ABAP_CODEPAGE` listed by hand. No list is kept.

`OSABAP_CPUPROFILE=<file>` writes Go's CPU profile of the run
(`go tool pprof -top <binary> <file>`); it is how an XML-to-XML converter report found
its four hot spots, all in the runtime and none in the report.

## osd run: F8 on a report

`osd run [--lib <folder>]... <report.prog.abap> [--] [arguments...]`
(`tools/osd-run.mjs`) builds the report with osabap and runs the command
with the arguments as given; F8 on a `.prog.abap` in VS Code types exactly
this into a terminal of its own, after asking for the arguments. Nothing
after the report is osd's: `--layer` there is the report's to refuse, and
one bare `--` right after the report is dropped, so `osd run x -- -help`
shows the report's help. The command is kept under `.local/osd-run/<hash>`
(or `$OSD_RUN_CACHE`; the newest 16 stay), the hash taken over the report
and the objects beside it, every `--lib` folder and the compiler: the files
git lists under `tools/gogen` (its runtime ABAP included) and `tools/*.mjs`,
open-abap-core and open-abap-gui by size and time, the `@abaplint/core` and
`@abaplint/transpiler` versions and the Go toolchain (`go env GOVERSION`,
`GOTOOLCHAIN`, `GOFLAGS`, `CGO_ENABLED`). The same source runs the kept
command at once, an edit builds again. Builds take a lock holding the
builder's pid, so a build stopped with Ctrl+C or killed leaves nothing the
next run waits for; `GOOS`/`GOARCH` are cleared, since the command runs
here. The build talks on stderr, so stdout is the report's alone, and a
build that fails ends `osd run` with 2. F8's terminal starts in the
checkout, so relative paths (`-db notes.db`) are the checkout's; on
Windows it is PowerShell, which the command line is quoted for. It needs a
checkout run by node; the bundled binary refuses and says so.

## Open SQL and the -db file

A report may bring tables of its own: the `.tabl.xml` files (and any
`.dtel.xml`, `.doma.xml`, `.ttyp.xml`) beside the report file are compiled
with it, and their CREATE TABLEs, as the transpiler writes them for the Node
host, go into the binary. `tools/gogen/apps/notes/` is the sample:

```sh
node tools/gogen/osabap.mjs tools/gogen/apps/notes/znotes.prog.abap
osabap -db notes.db --add "first note"      # 1 first note
osabap -db notes.db --add "second note"     # the first run's row is still there
osabap --add x                               # refused: run it with -db FILE
```

- `-db FILE` opens the SQLite file, creating it with the report's tables
  when it is missing (`abap.OpenDBFile`, the one `osgo --db` uses). Each
  dialog step is a database LUW: `COMMIT WORK` and `ROLLBACK WORK` behave as
  on a system, and a dump rolls the step back.
- A report with tables and no `-db` has no database. Its first statement
  refuses and names the flag. There is never a silent in-memory database
  whose rows vanish at exit.
- A file laid out by another build of the tables (a column changed, a table
  added) is refused, not used: the file carries a mark of the schema that
  created it.
- A report without tables is built without a database driver and refuses
  `-db`.

Which Open SQL forms compile is measured, not claimed:
`node tools/gogen/osabap-sql-corpus.mjs` compiles each of the 18 forms in
`tools/gogen/apps/sql-corpus/zsqlcorpus.abap` as a report of its own. On
2026-09-30, 12 compile. The six that do not are pinned by
`tools/gogen/osabap-sql-corpus.test.mjs`:
- an aggregate without GROUP BY into a scalar (`MAX`);
- `UP TO ... ORDER BY`;
- `APPENDING TABLE`;
- `INTO TABLE` of a SORTED table;
- a `GROUP BY` SELECT loop;
- an inline `@DATA( )` target.

One such form makes the whole method NOT_COMPILED.

## Terminal UI

With no arguments, a real terminal uses the tcell form in
`tools/gogen/go/termgui`:

- Tab and arrow keys move focus;
- typing edits the active parameter;
- Space toggles a checkbox;
- select-options accept comma-separated values and produce `I/EQ` rows;
- Enter executes;
- Escape cancels;
- mouse clicks move focus.

When stdin is not a terminal, OSABAP uses a deterministic line form instead.
That keeps the no-argument path testable through pipes.

## SAP GUI mode

```sh
osabap -sapgui
```

The command binds `127.0.0.1:3232` before starting the client. Port 3232 is
SAP DIAG instance 32. Binding first means a client is never launched toward an
empty endpoint.

Platform launchers are small build-tagged files:

- Windows finds `sapgui.exe` in `PATH`, `%ProgramFiles%`, or
  `%ProgramFiles(x86)%`, then runs `sapgui.exe 127.0.0.1 32`;
- macOS opens bundle `com.sap.platin` with
  `conn=/H/127.0.0.1/S/3232`;
- another platform can set `OSABAP_SAPGUI` to its client executable.

`OSABAP_SAPGUI` also overrides client discovery on Windows and macOS. Use
`-sapgui-no-launch` to listen without starting a client, for example when
testing the launch command separately:

```powershell
.\osabap.exe -sapgui-no-launch
& "C:\Program Files\SAP\FrontEnd\SAPGUI\sapgui.exe" 127.0.0.1 32
```

An alternate listener is accepted as `-sapgui=127.0.0.1:3201`. Direct
Windows launch derives the DIAG port from the final two digits as instance 01.

Report flags can accompany the frontend switch and prefill its fields:

```powershell
.\osabap.exe -sapgui --name Alice --loud
```

### DIAG session

The SAP GUI path uses `open-diag-go` for DIAG messages and DYNT atoms. Its
single-client sequence is:

1. accept one NI connection;
2. answer NI keepalives;
3. consume the client's initial frame (whose first message contains a
   200-byte dispatcher header);
4. send a complete identifier-free first dynpro wrapper with the generated
   selection screen substituted into `DYNT_ATOM`;
5. receive a PAI caused by F8, Enter or the Execute button;
6. map returned atoms to selection fields by their row and column;
7. execute the ordinary report lifecycle with `ONLI`;
8. replace `DYNT_ATOM` with a bounded result page containing messages and
   `WRITE` lines;
9. on Back, window close or the next action, send a DIAG header carrying
   end-of-conversation and end-of-program flags, then let the GUI disconnect.

The first-screen wrapper matters. The minimal synthetic
`diag.LogonScreen()` fixture is sufficient for encoder round-trip tests but is
not a complete real-client setup. It is only 587 bytes and omits the menu,
accelerator and session structures Windows SAP GUI expects. OSABAP therefore
embeds the 4676-byte identifier-free first wrapper derived and scrubbed by
`open-diag-go`'s `lsd` package, replaces only its screen atoms, and sends no
captured system, host, user or session identifiers.

The console emits a short bounded trace rather than wire payloads:

```text
SAP GUI connected from ...
SAP GUI initial frame: ... bytes, ... DIAG items
SAP GUI selection screen sent
SAP GUI report result sent
```

### Safety boundary

The DIAG endpoint has no SAP logon, SNC or authorization layer. It binds
loopback by default and should stay there for ordinary use. A connected
session is bounded to:

- five minutes;
- 64 client frames;
- 64 MiB per NI frame;
- one client and one report execution.

Timeout and frame exhaustion end the session with EOC/EOP. These limits also
bound diagnostic output and prevent a repeated client/server exchange from
growing without limit.

## Native frontend services

Inside a compiled native application, the local process is the frontend.
Selected `CL_GUI_FRONTEND_SERVICES` methods map directly to the host OS:

- file and directory existence;
- file size;
- text and binary upload/download;
- temporary directory;
- current working directory.

`ZCL_OSABAP_RUNTIME=>GETENV( name )` returns one named environment variable.
It deliberately does not expose the whole environment. The executable example
`tools/gogen/apps/io/zio.prog.abap` reads an environment variable and copies a
text file through these ABAP APIs.

## Current limits

The spike intentionally implements a small application runtime, not a whole
SAP system:

- Open SQL only on the report's own tables, through `-db` (12 of 18 corpus forms compile; see above);
- no OData, HTTP, ICF or Fiori host;
- one selection screen and one execution per process;
- select-options in interactive frontends currently use comma-separated
  inclusive `EQ` values rather than SAP's full multiple-selection dialog;
- the SAP GUI result is one bounded dynpro page, without list paging;
- one simultaneous SAP GUI connection;
- no SAP authentication, SNC or public-network hardening;
- only the `CL_GUI_FRONTEND_SERVICES` methods explicitly mapped by the native
  host are available.

These are frontend/runtime boundaries. They do not change the ABAP report
lifecycle or the common selection-value representation.

## Verification

The focused end-to-end suite builds the report and checks positional input,
named flags, JSON ranges, the no-argument screen, unknown-option rejection,
environment access and file copying:

```sh
node --test tools/gogen/osabap.test.mjs
```

The Go tests under `tools/gogen/go/cmd/osabap` additionally verify:

- frontend option separation;
- the no-launch variant;
- selection values returned from DYNT atoms;
- the complete real-client wrapper structure;
- a full in-memory NI/DIAG exchange: initial frame, selection screen, PAI,
  report result and clean EOC/EOP.

The Windows path is also cross-compiled during release verification. The
checked build command produces a stripped PE32+ AArch64 executable of
approximately 6.6 MiB.

## Implementation map

| Path | Responsibility |
| --- | --- |
| `tools/gogen/osabap.mjs` | conversion, closure compilation and native build |
| `tools/gogen/go/cmd/osabap/main.go` | mode selection and common report lifecycle |
| `tools/gogen/go/cmd/osabap/sapgui.go` | listener, DIAG session and screen/value mapping |
| `tools/gogen/go/cmd/osabap/sapgui_wrapper.go` | scrubbed complete first-frame template |
| `tools/gogen/go/cmd/osabap/sapgui_launch_*.go` | platform-specific client launch |
| `tools/gogen/go/termgui/form.go` | interactive terminal form |
| `tools/gogen/go/abap/frontend.go` | native filesystem/environment host functions |
| `tools/gogen/apps/runtime/` | small ABAP-visible native runtime facade |
| `tools/gogen/osabap.test.mjs` | focused generated-command tests |
