## ABAP keys

The default `osd.keymap` is `abap` over `.abap` files:

| Key | Action |
| --- | --- |
| Ctrl+F2 | Check the current buffer |
| Ctrl+F3 | Activate the current object |
| F8 | Run the current object or preview a table/CDS view |
| Ctrl+Shift+F10 | Run ABAP Unit for the current file (same as the beaker button) |
| F9 | Run an ABAP class as a console application |
| F5 / F6 / F7 / F8 | Step into / over / return / continue while execution is paused |

Set `osd.keymap` to `vscode` to restore VS Code's usual bindings.

F8 / ▷ / F9 never run ABAP Unit. F8 runs a class implementing
`IF_OO_ADT_CLASSRUN`, even if it has tests; reports run in a terminal.
A class with nothing to run shows “Nothing to run for <OBJ>. Tests:
Ctrl+Shift+F10.” Run tests with that key, the beaker button, or Test Explorer.
