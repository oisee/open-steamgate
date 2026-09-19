import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scan} from "../tools/osd-naming-scan.mjs";

// The naming rule as a check (backlog G.1d). What is asserted here is the
// property that makes it worth having: **it can fail.** A scanner that always
// passes is indistinguishable from one that has lost its patterns, and that
// is exactly how the leak scan pronounced a real leak clean once. So the
// suite builds a tree that ought to fail, and one that ought not.
describe("the naming rule, as something that can go red", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-naming-"));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  const write = (name, text) => {
    mkdirSync(join(dir, name, ".."), {recursive: true});
    writeFileSync(join(dir, name), text);
  };

  it("fails a page title that borrows a brand word", () => {
    write("page.html", "<html><head><title>SAP Data Browser</title></head></html>");
    const {findings} = scan(dir);
    expect(findings, JSON.stringify(findings)).to.have.length(1);
    expect(findings[0].position).to.equal("<title>");
    expect(findings[0].word).to.equal("SAP");
  });

  it("fails a pack name, a tile and an object description in their own right", () => {
    write("packs/x/osd-pack.json", JSON.stringify({name: "fiori-things", description: "ok"}));
    write("webapp/app/manifest.json", JSON.stringify({"sap.app": {title: "HANA Explorer"}}));
    write("src/zcl_x.clas.xml", "<abapGit><DESCRIPT>A NetWeaver thing</DESCRIPT></abapGit>");
    const {findings} = scan(dir);
    expect(findings.map((f) => f.position).sort())
      .to.deep.equal(["launchpad tile", "object description", "pack"]);
  });

  it("passes ABAP, because the headline the rule protects contains it", () => {
    // "An ABAP application server you can clone" is the agreed headline. A
    // check that failed the sentence it exists to protect would be wrong
    // about its own rule.
    write("page.html", "<title>An ABAP application server you can clone</title>");
    expect(scan(dir).findings).to.have.length(0);
  });

  it("passes a transaction code, which is a judgement written down rather than an oversight", () => {
    // in a title, SE16 is what the screen is called over there: a statement
    // of fact, and flagging it would flag mostly true sentences
    write("page.html", "<title>Data browser, the screen SE16 occupies</title>");
    expect(scan(dir).findings).to.have.length(0);
  });

  it("does not look at prose, because the position is what carries the distinction", () => {
    write("docs/note.md", "In a real SAP system code is branched by transports.");
    expect(scan(dir).findings).to.have.length(0);
  });

  it("counts a position once, however many places it looked", () => {
    write("page.html", "<title>SAP Thing</title>");
    const {findings} = scan(dir);
    expect(findings).to.have.length(1);
  });

  it("the tree as it stands is clean, and it read something while saying so", () => {
    const {looked, findings} = scan();
    expect(looked, "a scan that read nothing is not a pass").to.be.greaterThan(50);
    expect(findings, findings.map((f) => `${f.file}: ${f.value}`).join("\n")).to.have.length(0);
  });
});
