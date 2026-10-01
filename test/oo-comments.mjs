import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {findings, fix, filesOf} from "../tools/osd-oo-comments.mjs";
import {generate} from "../tools/segw-gen.mjs";
import {loadFunctionGroups} from "../tools/segw-gen-mapping.mjs";
import {compile} from "../tools/stg-compile.mjs";

// What a system refuses to store: a comment line between the parts of a
// class implementation (T100 OO_SOURCE_BASED 012, measured on A4H
// 2026-10-01). Every case below is one the lead measured, as a synthetic
// class; the lexical cases are the ones a regex would get wrong.
const CLASS = (def, impl) => `CLASS zcl_t DEFINITION PUBLIC.
  PUBLIC SECTION.
${def}    METHODS a.
    METHODS b.
ENDCLASS.
${impl}`;

const IMPL = (between1 = "", afterImpl = "", between2 = "", beforeEnd = "") => `${between1}CLASS zcl_t IMPLEMENTATION.
${afterImpl}  METHOD a.
    DATA s TYPE string.
  ENDMETHOD.
${between2}  METHOD b.
    DATA t TYPE string.
  ENDMETHOD.
${beforeEnd}ENDCLASS.
`;

const rows = (text) => findings(text, "zcl_t.clas.abap");

describe("a comment where a system refuses to store one (OO_SOURCE_BASED 012)", function () {
  // the CLI and tree cases spawn node and parse every class: seconds on a runner
  this.timeout(120000);
  describe("refused, as measured", () => {
    it("between two methods of the implementation", () => {
      const text = CLASS("", IMPL("", "", "  \" between\n"));
      expect(rows(text)).to.have.length(1);
    });
    it("between CLASS ... IMPLEMENTATION. and the first METHOD", () => {
      expect(rows(CLASS("", IMPL("", "* first\n")))).to.have.length(1);
    });
    it("after the last ENDMETHOD. and before the implementation's ENDCLASS.", () => {
      expect(rows(CLASS("", IMPL("", "", "", "  \" last\n")))).to.have.length(1);
    });
    it("between the definition's ENDCLASS. and CLASS ... IMPLEMENTATION.", () => {
      expect(rows(CLASS("", IMPL("* gap\n")))).to.have.length(1);
    });
    it("reports the line of each comment line", () => {
      const text = CLASS("", IMPL("", "", "  \" one\n  \" two\n"));
      expect(rows(text)).to.deep.equal([10, 11]);
    });
  });

  describe("accepted, as measured", () => {
    it("comments anywhere in the definition part", () => {
      expect(rows(CLASS("    \" in the definition\n* col 1\n"))).to.deep.equal([]);
      expect(rows(CLASS("    \" in the definition\n* col 1\n", IMPL()))).to.deep.equal([]);
    });
    it("a header comment before CLASS ... DEFINITION", () => {
      expect(rows(`* header\n" more header\n${CLASS("", IMPL())}`)).to.deep.equal([]);
    });
    it("a trailing comment after the final ENDCLASS.", () => {
      expect(rows(`${CLASS("", IMPL())}" the end\n* really\n`)).to.deep.equal([]);
    });
    it("comments inside METHOD ... ENDMETHOD.", () => {
      const impl = IMPL().replace("DATA s TYPE string.", "\" inside\n* col 1 inside\n    DATA s TYPE string.");
      expect(rows(CLASS("", impl))).to.deep.equal([]);
    });
    it("blank lines anywhere", () => {
      expect(rows(CLASS("\n\n", IMPL("\n\n", "\n\n", "\n\n", "\n\n")))).to.deep.equal([]);
    });
  });

  describe("lexical cases", () => {
    it("a string literal holding a quote or a star is not a comment", () => {
      const impl = IMPL().replace("DATA s TYPE string.", "DATA s TYPE string.\n    s = 'a \" b'.\n    s = `x\n* y`.");
      expect(rows(CLASS("", impl))).to.deep.equal([]);
    });
    it("a chained and a multi-line statement, with a comment inside, stay inside the method", () => {
      const impl = IMPL().replace("DATA s TYPE string.", "DATA: s TYPE string,\n      \" inside a chain\n      u TYPE string.\n    foo(\n      \" inside a call\n      1 ).");
      expect(rows(CLASS("", impl))).to.deep.equal([]);
    });
    it("a comment between the tokens of a multi-line METHOD statement is inside it", () => {
      const impl = IMPL().replace("METHOD a.", "METHOD a\n      \" inside the statement\n      .");
      expect(rows(CLASS("", impl))).to.deep.equal([]);
    });
    it("leading blanks, doc comments and pseudo-comments between methods are refused too", () => {
      for (const c of ["      \" blanks\n", "  \"! doc\n", "  \"#EC NEEDED\n"]) {
        expect(rows(CLASS("", IMPL("", "", c))), JSON.stringify(c)).to.have.length(1);
      }
    });
    it("a `*` that is not in column 1 is not a comment line", () => {
      const impl = IMPL().replace("DATA t TYPE string.", "DATA t TYPE string.\n    t = 1\n      * 2.");
      expect(rows(CLASS("", impl))).to.deep.equal([]);
    });
    it("lower, upper and mixed case keywords", () => {
      const text = `class zcl_t definition public.\n  public section.\n    methods a.\nendclass.\n\nClass zcl_t Implementation.\n  Method a.\n  EndMethod.\n  \" gap\n  METHOD b.\n  endmethod.\nEndClass.\n`
        .replace("methods a.", "methods a.\n    methods b.");
      expect(rows(text)).to.deep.equal([10]);
    });
    it("DEFERRED and LOAD lines before the class are not the definition", () => {
      const text = `CLASS zcl_other DEFINITION DEFERRED.\n* between deferred and the class\nCLASS zcl_other DEFINITION LOAD.\n${CLASS("", IMPL())}`;
      expect(rows(text)).to.deep.equal([]);
    });
    it("a comment trailing a statement is not a comment line and is not reported", () => {
      const text = CLASS("", IMPL()).replace("  ENDMETHOD.\n  METHOD b.", "  ENDMETHOD. \" done\n  METHOD b.");
      expect(rows(text)).to.deep.equal([]);
    });
    it("the local includes are not scanned", () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-oo-"));
      try {
        const bad = CLASS("", IMPL("* gap\n"));
        for (const name of ["zcl_t.clas.locals_imp.abap", "zcl_t.clas.locals_def.abap", "zcl_t.clas.testclasses.abap", "zcl_t.clas.macros.abap"]) {
          writeFileSync(join(dir, name), bad);
        }
        expect(filesOf([dir])).to.deep.equal([]);
        writeFileSync(join(dir, "zcl_t.clas.abap"), bad);
        expect(filesOf([dir])).to.deep.equal([join(dir, "zcl_t.clas.abap")]);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  });

  describe("--fix", () => {
    const commentLines = (t) => t.split("\n").filter((l) => /^\s*["*]/.test(l)).map((l) => l.trim()).sort();
    const bad = CLASS("", IMPL("* gap\n", "  \" first\n", "  \" between\n  \"   indented more\n\n", "  \" last\n"));

    it("the fixed text passes the check and keeps every comment line", () => {
      expect(rows(bad)).to.have.length(5);
      const {text, error} = fix(bad, "zcl_t.clas.abap");
      expect(error).to.equal(undefined);
      expect(rows(text)).to.deep.equal([]);
      expect(commentLines(text)).to.deep.equal(commentLines(bad));
    });
    it("moves a block just after the following METHOD line, with its relative indentation", () => {
      const {text} = fix(CLASS("", IMPL("", "", "  \" between\n    \" deeper\n")), "zcl_t.clas.abap");
      expect(text).to.contain("  METHOD b.\n    \" between\n      \" deeper\n    DATA t TYPE string.");
    });
    it("moves a block with no method after it into the preceding method, before ENDMETHOD", () => {
      const {text} = fix(CLASS("", IMPL("", "", "", "  \" last\n")), "zcl_t.clas.abap");
      expect(text).to.contain("    DATA t TYPE string.\n    \" last\n  ENDMETHOD.");
    });
    it("moves a star comment as it is, because it only counts in column 1", () => {
      const {text} = fix(CLASS("", IMPL("", "* first\n")), "zcl_t.clas.abap");
      expect(text).to.contain("  METHOD a.\n* first\n");
    });
    it("is idempotent", () => {
      const once = fix(bad, "zcl_t.clas.abap").text;
      expect(fix(once, "zcl_t.clas.abap").text).to.equal(once);
    });
    it("refuses an implementation with no methods", () => {
      const text = `CLASS zcl_t DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_t IMPLEMENTATION.\n  \" nothing to go into\nENDCLASS.\n`;
      expect(rows(text)).to.have.length(1);
      const result = fix(text, "zcl_t.clas.abap");
      expect(result.text).to.equal(undefined);
      expect(result.error).to.contain("no method");
    });
    it("the command exits 1 on a finding and 0 once fixed, and --fix does not write a refused file", () => {
      const dir = mkdtempSync(join(tmpdir(), "osd-oo-"));
      try {
        const file = join(dir, "zcl_t.clas.abap");
        const run = (...a) => spawnSync(process.execPath, ["tools/osd-oo-comments.mjs", ...a], {encoding: "utf8"});
        writeFileSync(file, bad);
        const red = run(file);
        expect(red.status).to.equal(1);
        expect(red.stdout).to.contain("comment outside a method in the class implementation (a system refuses to store this: OO_SOURCE_BASED 012)");
        expect(red.stdout).to.match(/zcl_t\.clas\.abap:\d+: comment outside/);
        expect(run("--fix", file).status).to.equal(0);
        expect(run(file).status).to.equal(0);
        const empty = `CLASS zcl_t DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_t IMPLEMENTATION.\n  \" x\nENDCLASS.\n`;
        writeFileSync(file, empty);
        expect(run("--fix", file).status).to.equal(1);
        expect(readFileSync(file, "utf8")).to.equal(empty);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  });

  describe("the tree and what generators write", () => {
    it("no class main include under src/ or a pack carries one", function () {
      this.timeout(60000);
      const files = filesOf([]);
      expect(files.length).to.be.greaterThan(50);
      const found = files.flatMap((f) => findings(readFileSync(f, "utf8"), f).map((r) => `${f}:${r}`));
      expect(found).to.deep.equal([]);
    });
    it("segw-gen writes classes without one (mini and mapped projects)", () => {
      const classes = [];
      for (const [name, opts] of [["zstg_mini", {}], ["zstg_mapped", {functionModules: loadFunctionGroups(["test/fixtures/segw"]), warnings: []}]]) {
        const {files, ext} = generate(readFileSync(`test/fixtures/segw/${name}.iwpr.xml`, "utf8"), opts);
        classes.push(...Object.entries({...files, ...ext}).filter(([n]) => n.endsWith(".clas.abap")));
      }
      expect(classes.length).to.be.greaterThan(5);
      for (const [name, text] of classes) expect(rows(text), name).to.deep.equal([]);
    });
    it("stg-compile writes classes without one (demo and mapped YAML)", () => {
      const classes = [];
      for (const file of ["src/demo/zstg_demo.stg.yaml", "src/demo_odc/zstg_odc.stg.yaml", "test/fixtures/segw/zstg_mapped.stg.yaml"]) {
        const result = compile(readFileSync(file, "utf8"), {file, functionModules: loadFunctionGroups(["test/fixtures/segw"])});
        classes.push(...Object.entries({...result.files, ...result.classes, ...result.ext}).filter(([n]) => n.endsWith(".clas.abap")));
      }
      expect(classes.length).to.be.greaterThan(5);
      for (const [name, text] of classes) expect(rows(text), name).to.deep.equal([]);
    });
    it("a built gen/ holds none either (skipped without a build)", function () {
      this.timeout(60000);
      if (!existsSync("gen/cds")) this.skip();
      const files = filesOf(["gen"]);
      expect(files.length).to.be.greaterThan(0);
      const found = files.flatMap((f) => findings(readFileSync(f, "utf8"), f).map((r) => `${f}:${r}`));
      expect(found).to.deep.equal([]);
    });
  });
});
