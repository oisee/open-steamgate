# Terminal F4 and file dialogs

`osd run` / `osabap` carries `AT SELECTION-SCREEN ON VALUE-REQUEST FOR
<parameter>` into the generated report class. In the terminal selection
screen, F4 calls that ABAP event for the focused field. A report whose values
are all supplied as options runs without a selection screen or value request.
`ON HELP-REQUEST` (F1) is rejected at build time. SAP GUI wrapper mode does
not implement F4; frontend dialog calls there report that they are available
only in the terminal selection screen.

The terminal browser uses DATASET's sandbox. Open and directory dialogs list
only `-allow-read` roots (write roots are readable); save lists only
`-allow-write` roots. A path or symlink outside a root is refused. F4 reports
the missing grant in the form footer. Arrows move, Enter descends or chooses a
file, Backspace goes up within the root, `/` filters, Space chooses the current
directory (or marks files with `MULTISELECTION = 'X'`), `n` enters an open or save name,
and Esc cancels. Enter returns marked files. Each chosen path is validated
again after the listing.

## ABAP contract

The following is **per SAP public documentation; it has not been checked on
A4H**. The class methods use `ACTION_OK = 0` and `ACTION_CANCEL = 9`:

| API | Output on selection | Output on cancel |
| --- | --- | --- |
| `CL_GUI_FRONTEND_SERVICES=>FILE_OPEN_DIALOG` | `FILE_TABLE` has one `FILENAME` row, or several with `MULTISELECTION = 'X'`; `RC` is the row count, `USER_ACTION = 0` | empty table, `RC = 0`, `USER_ACTION = 9` |
| `=>FILE_SAVE_DIALOG` | `FILENAME` is the basename, `PATH` the directory, `FULLPATH` the complete name, `USER_ACTION = 0` | `USER_ACTION = 9`; caller's path fields remain unchanged |
| `=>DIRECTORY_BROWSE` | `SELECTED_FOLDER` is the chosen directory | `SELECTED_FOLDER` remains unchanged |
| `F4_FILENAME` | `FILE_NAME` (IMPORTING to caller) receives the selected name | caller's value remains unchanged |
| `KD_GET_FILENAME_ON_F4` | `FILE_NAME` (CHANGING) receives the selected name | caller's value remains unchanged |

If the open dialog cannot run because it has no grant, a path is refused, or an
I/O operation fails, it returns an empty `FILE_TABLE` and `RC = -1`. Cancellation
returns `RC = 0` with `ACTION_CANCEL`. The terminal form also shows the failure
reason in its footer. Save and directory browse have no documented `RC` output:
on either cancellation or failure, save reports `ACTION_CANCEL` and keeps the
caller's path fields; directory browse keeps `SELECTED_FOLDER`. The terminal
form reports failures for these dialogs in its footer too.

For `F4_FILENAME`, the documented call supplies `PROGRAM_NAME`,
`DYNPRO_NUMBER`, and `FIELD_NAME` as EXPORTING inputs and receives
`FILE_NAME` under IMPORTING. For `KD_GET_FILENAME_ON_F4`, the documented
EXPORTING inputs are `PROGRAM_NAME`, `DYNPRO_NUMBER`, `FIELD_NAME`, `MASK`,
and `STATIC`; `FILE_NAME` is CHANGING, and SAP's example lists
`MASK_TOO_LONG = 1` under EXCEPTIONS. The terminal implementation accepts
these inputs but uses the sandbox's directory listing; it does not apply
`MASK` or the SAP GUI dynpro context. The terminal Cancel preserves
`FILE_NAME` and is not an exception. That behavior is an implementation
choice, not an A4H measurement.

SAP describes the [open dialog and its `FILE_TABLE`, `RC`, and `USER_ACTION` parameters](https://help.sap.com/docs/r/5a005e044eef436f8b27bbd3f73a3cfc/7.40.17/en-US/dd66b1a76d7044ff8fd46c04fdaec220.html), the [save dialog and action codes](https://help.sap.com/saphelp_em92/helpdata/en/d0/0754b08a6947c19ce3f43add7696cb/content.htm), and [`DIRECTORY_BROWSE`'s `SELECTED_FOLDER`](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/5a005e044eef436f8b27bbd3f73a3cfc/eb82368f3d144c15ba6cc73f64ebf861.html). SAP's examples show [`F4_FILENAME`'s `FILE_NAME` IMPORTING parameter](https://help.sap.com/docs/SUPPORT_CONTENT/abap/3353525680.html) and [`KD_GET_FILENAME_ON_F4`'s `FILE_NAME` CHANGING parameter](https://help.sap.com/docs/SUPPORT_CONTENT/abap/3353523952.html). The single-selection behavior and cancellation preservation above are this terminal implementation's choices.

`FILE_FILTER` accepts alternating descriptions and wildcard fields, such as
`Text (*.txt)|*.txt|All (*.*)|*.*`, with semicolon separated patterns. The
terminal browser shows the union of the patterns. `DEFAULT_EXTENSION` is
appended to an entered name without an extension. `INITIAL_DIRECTORY` sets the
starting folder when it is inside a granted root; `WINDOW_TITLE` heads the
browser. `DEFAULT_FILE_NAME` supplies the save name, and
`PROMPT_ON_OVERWRITE` defaults to `'X'` and asks yes or no before returning an
existing file; passing a space disables the prompt.
These input behaviors follow SAP's published parameter contract and remain
**unverified on A4H**.
