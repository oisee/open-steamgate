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

// The lowered source must parse again: a replacement the transpiler cannot
// read would fail far from here.
function unknownStatements(text) {
  const registry = new core.Registry().addFile(new core.MemoryFile(file, text)).parse();
  return registry.getFirstObject().getABAPFiles()[0].getStatements()
    .filter((statement) => statement.get().constructor.name === "Unknown")
    .map((statement) => statement.concatTokens());
}

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

  it("keeps a comment inside a multi-line SUBMIT on its own line", () => {
    const before = source("SUBMIT zgg_ex_012\n      \" explain this selection\n* and a full-line one\n      WITH p_date = lv_date AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain('" explain this selection');
    expect(after).to.contain("\n* and a full-line one\n");
    expect(after.split("\n").length).to.equal(before.split("\n").length);
    expect(unknownStatements(after)).to.deep.equal([]);
  });

  it("keeps a comment on the first line of the statement", () => {
    const before = source("SUBMIT zgg_ex_012 \" first\n      WITH p_date = lv_date AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.match(/submit\( iv_program = 'ZGG_EX_012'.*\). " first/);
    expect(unknownStatements(after)).to.deep.equal([]);
  });

  it("accepts VIA JOB anywhere among the additions, before AND RETURN", () => {
    const before = source("SUBMIT zgg_ex_012 WITH p_date = lv_date VIA JOB lv_job NUMBER lv_count WITH p_count = 2 AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("submit_via_job( iv_program = 'ZGG_EX_012' iv_jobname = lv_job iv_jobcount = lv_count");
    expect(after).to.contain("( name = 'P_DATE' value = CONV string( lv_date ) )");
    expect(after).to.contain("( name = 'P_COUNT' value = CONV string( 2 ) )");
    expect(unknownStatements(after)).to.deep.equal([]);
  });

  it("takes component, instance and static access as one operand", () => {
    const before = source("SUBMIT zgg_ex_012\n      WITH p_date = ls_job-date\n      VIA JOB me->mv_job NUMBER zcl_counter=>gv_count\n      WITH p_count = lo_step->count AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("iv_jobname = me->mv_job iv_jobcount = zcl_counter=>gv_count");
    expect(after).to.contain("CONV string( ls_job-date )");
    expect(after).to.contain("CONV string( lo_step->count )");
    expect(after.split("\n").length).to.equal(before.split("\n").length);
  });

  it("takes a negative numeric literal", () => {
    const after = lowerNarrowSubmit(source("SUBMIT zgg_ex_012 WITH p_count = -3 AND RETURN."), file, core);
    expect(after).to.contain("( name = 'P_COUNT' value = CONV string( -3 ) )");
    expect(unknownStatements(after)).to.deep.equal([]);
  });

  it("refuses a negated name, which is not a data object", () => {
    expect(() => lowerNarrowSubmit(source("SUBMIT zgg_ex_012 WITH p_count = -lv_x AND RETURN."), file, core))
      .to.throw("supported SUBMIT form");
  });

  it("takes a namespaced report name up to 40 characters", () => {
    const name = "/OSDNS/ZREPORT_WITH_A_LONG_NAME_OF_40";
    expect(name.length).to.be.at.most(40);
    const after = lowerNarrowSubmit(source(`SUBMIT ${name} AND RETURN.`), file, core);
    expect(after).to.contain(`iv_program = '${name}'`);
  });

  it("passes WITH sel IN range as selection ranges on a synchronous SUBMIT", () => {
    const before = source("SUBMIT zgg_ex_012 WITH s_date IN lt_range WITH p_count EQ 2 AND RETURN.");
    const after = lowerNarrowSubmit(before, file, core);
    expect(after).to.contain("( name = 'S_DATE' ranges = zcl_osd_submit_ranges=>of( lt_range ) )");
    expect(after).to.contain("( name = 'P_COUNT' value = CONV string( 2 ) )");
    expect(after).to.contain("iv_batch = sy-batch");
    expect(unknownStatements(after)).to.deep.equal([]);
  });

  it("refuses WITH ... IN through VIA JOB and says why, instead of dropping the range", () => {
    const form = source("SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_number WITH s_date IN lt_range AND RETURN.");
    expect(() => lowerNarrowSubmit(form, file, core)).to.throw("the job step input carries name/value pairs only");
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
    "SUBMIT zgg_ex_012 VIA JOB lv_job NUMBER lv_a VIA JOB lv_job NUMBER lv_b AND RETURN.",
    "SUBMIT /OSDNS/ZREPORT_WITH_A_NAME_LONGER_THAN_FORTY AND RETURN.",
    "SUBMIT zgg_ex_012 WITH p_date = lv_date AND RETURN WITH p_count = 2.",
    "SUBMIT zgg_ex_012 WITH p_date = lv_date WITH p_date = lv_other AND RETURN.",
  ]) {
    it(`refuses ${form}`, () => {
      expect(() => lowerNarrowSubmit(source(form), file, core)).to.throw("supported SUBMIT form");
    });
  }
});
