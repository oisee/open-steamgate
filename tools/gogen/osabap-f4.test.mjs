import test from "node:test";
import assert from "node:assert/strict";
import {parseSource} from "../../.local/lars/open-abap-gui/converter/src/parser.mjs";
import {prepareF4} from "./osabap-f4.mjs";

test("F4 rewriting follows parsed event statements and leaves comments and strings intact", () => {
  const source = `REPORT zpick.\nPARAMETERS p TYPE string.\n* AT SELECTION-SCREEN ON HELP-REQUEST FOR p.\nDATA note TYPE string VALUE 'AT SELECTION-SCREEN ON VALUE-REQUEST FOR p.'.\nAT SELECTION-SCREEN ON VALUE-REQUEST FOR p.\n  p = 'FILE_OPEN_DIALOG'.\n  CALL METHOD cl_gui_frontend_services=>file_open_dialog.\nSTART-OF-SELECTION.\n  p = 'unchanged'.\n`;
  const result = prepareF4(source, parseSource(source, "zpick.prog.abap"));
  assert.deepEqual(result.fields, ["P"]);
  assert.equal(result.dialogCalls.length, 1);
  assert.match(result.convertedSource, /MOVE 'FILE_OPEN_DIALOG' TO p\./);
  assert.match(result.convertedSource, /START-OF-SELECTION\.\n  p = 'unchanged'\./);
  assert.match(result.convertedSource, /\* AT SELECTION-SCREEN ON HELP-REQUEST FOR p\./);
  assert.match(result.convertedSource, /VALUE 'AT SELECTION-SCREEN ON VALUE-REQUEST FOR p\.'/);
});

test("real HELP-REQUEST is refused", () => {
  const source = "REPORT zpick.\nAT SELECTION-SCREEN ON HELP-REQUEST FOR p.\n";
  assert.throws(() => prepareF4(source, parseSource(source, "zpick.prog.abap")), /HELP-REQUEST/);
});
