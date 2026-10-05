import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve, join} from "node:path";
import {build, liveHash} from "../tools/osd-build.mjs";
import {WarmCompiler, warmRule} from "../tools/osd-warm.mjs";
import {WarmCompilerProcess} from "../tools/osd-warm-process.mjs";

describe("warm ADT edit loop", function () {
  this.timeout(120000);
  let root, compiler;
  const provider = `CLASS zcl_wc DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS get RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_wc IMPLEMENTATION.
 METHOD get.
 rv = 1.
 ENDMETHOD.
ENDCLASS.
`;
  const sources = {
    "zcl_wc.clas.abap": provider,
    "zcl_wc_caller.clas.abap": provider.replaceAll("zcl_wc", "zcl_wc_caller").replace("rv = 1.", "rv = zcl_wc=>get( )."),
    "zw_inc.prog.abap": "DATA gv_value TYPE i.\ngv_value = 1.\n",
    "zw_report.prog.abap": "REPORT zw_report.\nINCLUDE zw_inc.\nWRITE gv_value.\n",
    "zw_text_inc.prog.abap": "WRITE 'constant'.\n",
    "zw_text_report.prog.abap": "REPORT zw_text_report.\nINCLUDE zw_text_inc.\n",
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-warm-edit-"));
    mkdirSync(join(root, "src"));
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(root, "src", name), source);
    writeFileSync(join(root, "src", "zw_inc.prog.xml"), '<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><PROGDIR><NAME>ZW_INC</NAME><SUBC>I</SUBC></PROGDIR></asx:values></asx:abap></abapGit>');
    writeFileSync(join(root, "src", "zw_text_inc.prog.xml"), '<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><PROGDIR><NAME>ZW_TEXT_INC</NAME><SUBC>I</SUBC></PROGDIR></asx:values></asx:abap></abapGit>');
    writeFileSync(join(root, "package.json"), '{}');
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", input_filter: [], output_folder: "output", libs: [], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"}}));
    symlinkSync(join(resolve("."), "node_modules"), join(root, "node_modules"));
    await build({root, generators: false});
    compiler = new WarmCompiler({root});
    await compiler.prime();
  });
  after(async () => { await compiler?.drop(); if (root) rmSync(root, {recursive: true, force: true}); });

  it("checks dependents and restores the registry without publishing editor text", async () => {
    const hash = liveHash(root);
    const result = await compiler.check({type: "CLAS", name: "ZCL_WC", source: provider.replaceAll("get", "renamed")});
    expect(result.issues.some(i => i.message.includes("ZCL_WC_CALLER")), JSON.stringify(result)).to.equal(true);
    expect(liveHash(root)).to.equal(hash);
    expect(readFileSync(join(root, "src", "zcl_wc.clas.abap"), "utf8")).to.equal(provider);
    expect((await compiler.check({type: "CLAS", name: "ZCL_WC", source: provider})).issues).to.deep.equal([]);
  });

  it("rebuilds the report consuming an include and requests runtime recycling", async () => {
    const checked = await compiler.check({type: "INCL", name: "ZW_INC", source: sources["zw_inc.prog.abap"].replaceAll("gv_value", "gv_renamed")});
    expect(checked.issues.some(i => i.message.includes("ZW_REPORT")), JSON.stringify(checked)).to.equal(true);
    writeFileSync(join(root, "src", "zw_inc.prog.abap"), sources["zw_inc.prog.abap"].replace("= 1", "= 2"));
    const result = await compiler.build();
    expect(result.modules).to.include("zw_report.prog.mjs");
    expect(result.hostHeld).to.include("zw_report.prog.mjs");
    const verification = await compiler.verify(result.hash);
    expect(verification.verdict, JSON.stringify(verification)).to.equal("same");
  });

  it("tracks INCLUDE consumers without an identifier reference into the include", async () => {
    expect(compiler.closureOf("PROG", "ZW_TEXT_INC").map(o => o.name)).to.include("ZW_TEXT_REPORT");
    writeFileSync(join(root, "src", "zw_text_inc.prog.abap"), "WRITE 'changed'.\n");
    const result = await compiler.build();
    expect(result.modules).to.include("zw_text_report.prog.mjs");
    expect(result.hostHeld).to.include("zw_text_report.prog.mjs");
    const verification = await compiler.verify(result.hash);
    expect(verification.verdict, JSON.stringify(verification)).to.equal("same");
  });

  it("checks in the compiler worker without corrupting subsequent compilation", async () => {
    const worker = new WarmCompilerProcess({root});
    try {
      await worker.prime();
      const bad = await worker.check({type: "CLAS", name: "ZCL_WC", source: provider.replaceAll("get", "renamed")});
      expect(bad.issues.length).to.be.greaterThan(0);
      expect((await worker.check({type: "CLAS", name: "ZCL_WC", source: provider})).issues).to.deep.equal([]);
      writeFileSync(join(root, "src", "zcl_wc.clas.abap"), provider.replace("rv = 1", "rv = 3"));
      const result = await worker.build();
      expect(result.modules).to.include("zcl_wc_caller.clas.mjs");
      const verification = await worker.verify(result.hash);
      expect(verification.verdict, JSON.stringify(verification)).to.equal("same");
    } finally { await worker.shutdown(); }
  });

  it("keeps generator-sensitive report changes on the cold path", () => {
    const before = sources["zw_report.prog.abap"];
    expect(warmRule({path: "src/zw_report.prog.abap", before, after: before + "\n"})).to.match(/generator/);
    expect(warmRule({path: "src/zw_inc.prog.abap", before: "SUBMIT x AND RETURN.", after: ""})).to.match(/SUBMIT/);
  });
});
