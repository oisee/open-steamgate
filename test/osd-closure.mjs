import {expect} from "chai";
import {code, closure, index} from "../tools/osd-closure.mjs";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

// What an entry point actually needs, so that only that gets built. The rule
// this enforces is narrow and load-bearing: a broken class nobody calls must
// not be able to stop a service that would have worked.
describe("tools/osd-closure: what one object reaches", () => {
  let dir;

  const clas = (name, body) => writeFileSync(join(dir, `${name.toLowerCase()}.clas.abap`),
    `CLASS ${name.toLowerCase()} DEFINITION PUBLIC.\nENDCLASS.\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\n${body}\nENDCLASS.\n`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-closure-"));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("follows a call, and keeps following it", () => {
    clas("ZCL_A", "  METHOD m. lo = NEW zcl_b( ). ENDMETHOD.");
    clas("ZCL_B", "  METHOD m. lo = NEW zcl_c( ). ENDMETHOD.");
    clas("ZCL_C", "  METHOD m. ENDMETHOD.");
    clas("ZCL_UNUSED", "  METHOD m. ENDMETHOD.");
    const names = closure(dir, ["ZCL_A"]).objects.map((o) => o.name);
    expect(names).to.deep.equal(["ZCL_A", "ZCL_B", "ZCL_C"]);
  });

  // the measurement that made this tool honest. A 962-line handler serving
  // HTML named half its repository inside the player's markup, so scanning
  // raw text said it reached 67 of 121 objects when it reaches exactly one
  it("a name inside a string literal is not a call", () => {
    clas("ZCL_A", "  METHOD m. lv = 'run zcl_b now'. ENDMETHOD.");
    clas("ZCL_B", "  METHOD m. ENDMETHOD.");
    expect(closure(dir, ["ZCL_A"]).objects.map((o) => o.name)).to.deep.equal(["ZCL_A"]);
  });

  it("a name inside a comment is not a call either", () => {
    clas("ZCL_A", "  METHOD m.\n* zcl_b does this\n    lv = 1. \" and zcl_b that\n  ENDMETHOD.");
    clas("ZCL_B", "  METHOD m. ENDMETHOD.");
    expect(closure(dir, ["ZCL_A"]).objects.map((o) => o.name)).to.deep.equal(["ZCL_A"]);
  });

  // the exception that keeps the stripping honest: a string template is a
  // literal, but what is inside its braces is code and does call things
  it("an expression inside a string template is a call", () => {
    clas("ZCL_A", "  METHOD m. lv = |text { zcl_b=>go( ) } more|. ENDMETHOD.");
    clas("ZCL_B", "  METHOD m. ENDMETHOD.");
    expect(closure(dir, ["ZCL_A"]).objects.map((o) => o.name)).to.deep.equal(["ZCL_A", "ZCL_B"]);
  });

  it("a longer name is not matched by a shorter one that prefixes it", () => {
    clas("ZCL_CELL16", "  METHOD m. ENDMETHOD.");
    clas("ZCL_CELL120", "  METHOD m. lo = NEW zcl_cell16( ). ENDMETHOD.");
    expect(closure(dir, ["ZCL_CELL16"]).objects.map((o) => o.name)).to.deep.equal(["ZCL_CELL16"]);
  });

  // an entry that is not there must say so: building nothing and reporting
  // nothing is the failure this whole exercise exists to avoid
  it("an entry point that is not in the folder is named, not ignored", () => {
    clas("ZCL_A", "  METHOD m. ENDMETHOD.");
    const result = closure(dir, ["ZCL_A", "ZCL_NOWHERE"]);
    expect(result.missing).to.deep.equal(["ZCL_NOWHERE"]);
  });

  it("the index knows an object by name whatever its type", () => {
    clas("ZCL_A", "  METHOD m. ENDMETHOD.");
    writeFileSync(join(dir, "zif_x.intf.abap"), "INTERFACE zif_x PUBLIC.\nENDINTERFACE.\n");
    expect([...index(dir).keys()].sort()).to.deep.equal(["ZCL_A", "ZIF_X"]);
  });

  it("code() keeps the code and drops the rest", () => {
    expect(code("* whole line\n  lv = 'literal'. \" trailing\n  lo = NEW zcl_x( ).")).to.contain("zcl_x");
    expect(code("  lv = 'zcl_hidden'.")).to.not.contain("zcl_hidden");
  });
});
