import {expect} from "chai";
import * as core from "@abaplint/core";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";

const file = "zcl_submit_probe.clas.abap";
const source = (statement) => `CLASS zcl_submit_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION. CLASS-METHODS run.
ENDCLASS.
CLASS zcl_submit_probe IMPLEMENTATION.
  METHOD run.
    ${statement}
  ENDMETHOD.
ENDCLASS.`;

describe("static narrow SUBMIT lowering", () => {
  it("passes scalar selections and the caller's batch mode to the one-shot registry", () => {
    const before = source("SUBMIT zgg_ex_012 WITH p_date = lv_date AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("zcl_osd_batch_report=>submit( iv_program = 'ZGG_EX_012'");
    expect(after).to.contain("( name = 'P_DATE' value = CONV string( lv_date ) )");
    expect(after).to.contain("iv_batch = sy-batch");
    expect(after.split("\n").length).to.equal(before.split("\n").length);
  });

  it("lowers two selections, preserving later source rows", () => {
    const before = source("SUBMIT zgg_ex_012\n      WITH p_date = '20251231'\n      WITH p_count = 2\n      AND RETURN.\n    DATA lv_after TYPE i.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("( name = 'P_DATE' value = CONV string( '20251231' ) )");
    expect(after).to.contain("( name = 'P_COUNT' value = CONV string( 2 ) )");
    expect(after.split("\n").length).to.equal(before.split("\n").length);
  });

  it("lowers static VIA JOB with bounded scalar selections", () => {
    const before = source("SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_count WITH p_date = lv_date AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("submit_via_job( iv_program = 'ZGG_EX_012' iv_jobname = lv_job iv_jobcount = lv_count");
    expect(after).to.contain("( name = 'P_DATE' value = CONV string( lv_date ) )");
    expect(after.split("\n").length).to.equal(before.split("\n").length);
  });

  it("does not rewrite comments or string literals", () => {
    const before = source("* SUBMIT zgg_ex_012 AND RETURN.\n    DATA lv_text TYPE string VALUE 'SUBMIT zgg_ex_012 AND RETURN.'.");
    expect(lowerNarrowSubmit(before, file, core)).to.equal(before);
  });

  it("keeps a quote character inside a selection literal", () => {
    const after = lowerNarrowSubmit(source(`SUBMIT zgg_ex_012 WITH p_date = 'a"b' AND RETURN.`), file, core);
    expect(after).to.contain(`CONV string( 'a"b' )`);
  });

  it("refuses to erase a comment within a multi-line SUBMIT", () => {
    const before = source("SUBMIT zgg_ex_012\n      \" explain this selection\n      WITH p_date = lv_date AND RETURN.");
    expect(() => lowerNarrowSubmit(before, file, core)).to.throw("move comments above SUBMIT");
  });

  for (const form of [
    "SUBMIT (lv_program) AND RETURN.",
    "SUBMIT zgg_ex_012 VIA JOB lv_job AND RETURN.",
    "SUBMIT (lv_program) VIA JOB lv_job NUMBER lv_number AND RETURN.",
    "SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_number WITH p_date IN lt_range AND RETURN.",
    "SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_number USING SELECTION-SET 'X' AND RETURN.",
    "SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_number TO SAP-SPOOL AND RETURN.",
    "SUBMIT zgg_ex_012 EXPORTING LIST TO MEMORY AND RETURN.",
    "SUBMIT zgg_ex_012 WITH p_date = lv_date.",
    "SUBMIT zgg_ex_012 WITH p_date IN lt_range AND RETURN.",
    "SUBMIT zgg_ex_012 WITH p_date = lv_date WITH p_date = lv_other AND RETURN.",
  ]) {
    it(`refuses ${form}`, () => {
      expect(() => lowerNarrowSubmit(source(form), file, core)).to.throw("supported SUBMIT form");
    });
  }
});
