import test from "node:test";
import assert from "node:assert/strict";
import {parseSource} from "../../.local/lars/open-abap-gui/converter/src/parser.mjs";
import {convertProgram} from "../../.local/lars/open-abap-gui/converter/src/api.mjs";
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

test("select-option LOW and HIGH value requests keep their component names", () => {
  const source = `REPORT zpickrange.\nDATA gv_file TYPE string.\nSELECT-OPTIONS s_file FOR gv_file.\nAT SELECTION-SCREEN ON VALUE-REQUEST FOR s_file-low.\n  s_file-low = 'a.txt'.\nAT SELECTION-SCREEN ON VALUE-REQUEST FOR s_file-high.\n  s_file-high = 'z.txt'.\nSTART-OF-SELECTION.\n`;
  const result = prepareF4(source, parseSource(source, "zpickrange.prog.abap"));
  assert.deepEqual(result.fields, ["S_FILE-LOW", "S_FILE-HIGH"]);
  assert.deepEqual(result.events, result.fields);
  assert.match(result.convertedSource, /s_file-low = 'a.txt'/);
});

test("F4 preserves an entire block after assignments with punctuation in literals", () => {
  const source = `REPORT zpick.\nPARAMETERS p TYPE string.\nDATA note TYPE string.\nAT SELECTION-SCREEN ON VALUE-REQUEST FOR p.\n  note = 'before'.\n  p = 'a.txt'.\n  note = 'after: one'.\n  p = 'say ''hello'': a.txt'.\n  CALL METHOD cl_gui_frontend_services=>file_open_dialog.\n  note = 'after call'.\nSTART-OF-SELECTION.\n  p = 'unchanged'.\n`;
  const result = prepareF4(source, parseSource(source, "zpick.prog.abap"));
  assert.equal(result.dialogCalls.length, 1);
  assert.match(result.convertedSource, /MOVE 'a\.txt' TO p\./);
  assert.match(result.convertedSource, /MOVE 'say ''hello'': a\.txt' TO p\./);
  assert.match(result.convertedSource, /MOVE 'before' TO note\.[\s\S]*MOVE 'after: one' TO note\.[\s\S]*CALL METHOD[\s\S]*MOVE 'after call' TO note\./);
  assert.match(result.convertedSource, /START-OF-SELECTION\.\n  p = 'unchanged'\./);
});

test("F4 conversion keeps helper assignments, branches, and the final dialog call", async () => {
  const source = `REPORT zpick.\nPARAMETERS p TYPE string.\nDATA note TYPE string.\nAT SELECTION-SCREEN ON VALUE-REQUEST FOR p.\n  note = 'first'.\n  note = 'second'.\n  IF p IS INITIAL.\n    note = 'inside'.\n  ELSE.\n    note = 'outside'.\n  ENDIF.\n  CASE note.\n    WHEN 'inside'.\n      p = 'a.txt'.\n    WHEN OTHERS.\n      p = 'b.txt'.\n  ENDCASE.\n  CALL METHOD cl_gui_frontend_services=>file_open_dialog.\nSTART-OF-SELECTION.\n`;
  const {convertedSource} = prepareF4(source, parseSource(source, "zpick.prog.abap"));
  const converted = await convertProgram({source: convertedSource, filename: "zpick.prog.abap", mode: "strict", nativePassthrough: true, className: "ZCL_OSABAP_PICK", transactionCode: "ZPICK"});
  assert.equal(converted.supported, true, JSON.stringify(converted.diagnostics));
  const method = /METHOD zif_gg_report_v1~at_selection_screen_value_req\.[\s\S]*?ENDMETHOD\./.exec(converted.classSource)?.[0];
  assert.ok(method);
  assert.match(method, /MOVE 'first' TO note\.[\s\S]*MOVE 'second' TO note\./);
  assert.match(method, /IF mv_p IS INITIAL\.[\s\S]*ELSE\.[\s\S]*ENDIF\./);
  assert.match(method, /CASE note\.[\s\S]*WHEN 'inside'\.[\s\S]*MOVE 'a.txt' TO mv_p\.[\s\S]*WHEN OTHERS\.[\s\S]*MOVE 'b.txt' TO mv_p\.[\s\S]*ENDCASE\./);
  assert.match(method, /ENDCASE\.[\s\S]*CALL METHOD cl_gui_frontend_services=>file_open_dialog\./);
});
