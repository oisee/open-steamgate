import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {check, loadList, localCounts, tableOf, LIST} from "../tools/osd-ddic-reserved.mjs";

// A field a system refuses to activate because its name is a reserved word
// ("RULE is a reserved word (choose another field name)", A4H 2026-10-01,
// ZOSD_L3_ALERT). Synthetic tables only; the system's own list never appears
// in a test.
const TABLE = (name, fields, tabclass = "TRANSP") => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V><TABNAME>${name}</TABNAME><TABCLASS>${tabclass}</TABCLASS></DD02V>
   <DD03P_TABLE>
${fields.map((f) => `    <DD03P><FIELDNAME>${f}</FIELDNAME></DD03P>`).join("\n")}
   </DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;
const list = () => ({
  words: new Map([["RULE", ["mssql", "measured"]], ["ZONE", ["odbc", "measured"]], ["LENGTH", ["maxdb"]], ["ROLE", ["db2"]]]),
  accepted: new Map([["LENGTH", {why: "measured accepted"}]]),
  allow: new Map([["ZT_KNOWN-ROLE", {why: "debt", kind: "unmeasured"}]]),
  refused: new Set(["RULE", "ZONE"]),
});

describe("DDIC reserved field names (tools/osd-ddic-reserved.mjs)", () => {
  it("refuses a customer table's field named by a reserved word, and names the lists it is in", () => {
    expect(check(TABLE("ZT_LOG", ["MANDT", "RULE", "RULE_NAME"]), list())).to.deep.equal([{table: "ZT_LOG", field: "RULE", parts: ["mssql", "measured"]}]);
  });

  it("checks structures too", () => {
    expect(check(TABLE("ZT_S", ["ZONE"], "INTTAB"), list()).map((f) => f.field)).to.deep.equal(["ZONE"]);
  });

  it("leaves SAP's own tables alone, and .INCLUDE rows", () => {
    expect(check(TABLE("TBTCX", ["RULE"]), list())).to.deep.equal([]);
    expect(tableOf(TABLE("ZT_I", [".INCLUDE", "A"])).fields).to.deep.equal(["A"]);
  });

  it("passes a word measured accepted, and an allowed field, but never a measured refusal by word", () => {
    expect(check(TABLE("ZT_A", ["LENGTH"]), list())).to.deep.equal([]);
    expect(check(TABLE("ZT_KNOWN", ["ROLE"]), list())).to.deep.equal([]);
    expect(check(TABLE("ZT_OTHER", ["ROLE"]), list())).to.have.length(1);
    const l = list();
    l.accepted.set("RULE", {why: "wrong"});
    expect(check(TABLE("ZT_LOG", ["RULE"]), l)).to.have.length(1);
  });

  it("the tracked list names a public source for every part and holds the measured refusals", () => {
    const doc = JSON.parse(readFileSync(LIST, "utf8"));
    for (const part of doc.parts) expect(part.source.length, part.name).to.be.above(20);
    const loaded = loadList();
    for (const w of ["RULE", "LABEL", "ZONE", "HANDLER", "SECTION", "PARAMETER"]) expect(loaded.words.has(w), w).to.equal(true);
    for (const entry of doc.allow) expect(entry.why.length, entry.field).to.be.above(20);
  });

  it("counts what a local list adds without saying which words", () => {
    const counts = localCounts(["RULE", "QQWORD", "QQOTHER"], list(), [tableOf(TABLE("ZT_X", ["QQWORD", "RULE"])), tableOf(TABLE("TSAP", ["QQOTHER"]))]);
    expect(counts).to.deep.equal({size: 3, uncovered: 2, fields: 1});
  });

  it("the command fails on a folder with a finding, and with a local list prints counts and never its words", () => {
    const dir = mkdtempSync(join(tmpdir(), "ddic-reserved-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "zt_log.tabl.xml"), TABLE("ZT_LOG", ["RULE", "QQSECRETWORD"]));
      const local = join(dir, "trese.json");
      writeFileSync(local, JSON.stringify({words: ["RULE", "QQSECRETWORD", "QQUNUSEDWORD"]}));
      const run = spawnSync(process.execPath, ["tools/osd-ddic-reserved.mjs", join(dir, "src")],
        {encoding: "utf8", env: {...process.env, OSD_DDIC_TRESE: local}});
      expect(run.status, run.stderr).to.equal(1);
      expect(run.stdout).to.contain("ZT_LOG-RULE: RULE is a reserved word");
      expect(run.stdout).to.match(/local system list: 3 words, 2 of them not in the public list; 1 field\(s\) of the tree/);
      expect(run.stdout + run.stderr).to.not.match(/QQSECRETWORD|QQUNUSEDWORD/);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("the tree has no finding and no allow entry it does not need", () => {
    const run = spawnSync(process.execPath, ["tools/osd-ddic-reserved.mjs"], {encoding: "utf8"});
    expect(run.status, run.stdout).to.equal(0);
    expect(run.stdout).to.match(/, 0 finding\(s\)/);
  });
});
