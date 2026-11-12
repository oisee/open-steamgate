import {expect} from "chai";
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {run} from "../tools/hana-src-gen.mjs";
import {expandedFolders} from "../tools/osd-packs.mjs";
import {layers} from "../tools/osd-inputs.mjs";

// The tenant's sources as input layers (tools/hana-src-gen.mjs, H4).
//
// One seam, without a dump: the fixture is a converter output directory
// (plan.json + layers/<name>/{.abapgit.xml, src/}) built in a temp dir, the
// way dump-to-layers.mjs writes it. Objects and packages are ZOSD_H4_*;
// layer names are the converter's <system>-<package> of those. The layering
// case is held the way H3 holds its: the folders become inputs before src/
// and a hand-written src/ file of the same name wins.

// the .abapgit.xml the converter writes, verbatim from the fixture sample
const ABAPGIT_XML = `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA><MASTER_LANGUAGE>E</MASTER_LANGUAGE><STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>PREFIX</FOLDER_LOGIC></DATA>
 </asx:values>
</asx:abap>
`;

// a converter output directory: plan.json plus the layer folders named in it
const converterOutput = () => {
  const root = mkdtempSync(join(tmpdir(), "hana-src-gen-"));
  const written = [];
  const layer = (name, pkg, order, files = []) => {
    written.push({name, package: pkg, folder: `layers/${name}`, order, objects: files.length === 0 ? {} : {PROG: files.length}});
    mkdirSync(join(root, "layers", name, "src"), {recursive: true});
    writeFileSync(join(root, "layers", name, ".abapgit.xml"), ABAPGIT_XML);
    for (const [file, body] of files) writeFileSync(join(root, "layers", name, "src", file), body);
  };
  const plan = (extra = {}) => {
    writeFileSync(join(root, "plan.json"), JSON.stringify({
      schema: 1, system: "osd",
      dump: {manifest_sha256: "f".repeat(64), provenance: "the H4 fixtures' own test bed"},
      layers: [...written].sort((a, b) => a.order - b.order),
      cycles: [], no_source: {TABL: 1}, orphans: [], errors: [],
      empty_layers: {count: 0, names: []}, unpackaged_groups: 0,
      ...extra,
    }, undefined, 2));
  };
  return {root, layer, plan};
};

const out = (root) => join(root, "gen-out");

describe("hana-src-gen: the tenant's sources as input layers", () => {
  it("orders and zero-pads the layers", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-b", "$ZOSD_H4_B", 2, [["zosd_h4_b.prog.abap", "REPORT zosd_h4_b.\n"]]);
      f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
      f.layer("osd-tmp-zosd-h4-c", "$ZOSD_H4_C", 11, [["zosd_h4_c.prog.abap", "REPORT zosd_h4_c.\n"]]);
      f.plan();
      expect(await run(["--layers", f.root, "--out", out(f.root)])).to.equal(0);
      expect(readdirSync(out(f.root)).sort()).to.deep.equal([
        "000-osd-tmp-zosd-h4-a", "002-osd-tmp-zosd-h4-b", "011-osd-tmp-zosd-h4-c", "manifest.json"]);
      expect(readFileSync(join(out(f.root), "002-osd-tmp-zosd-h4-b", "src", "zosd_h4_b.prog.abap"), "utf8"))
        .to.equal("REPORT zosd_h4_b.\n");
      expect(readFileSync(join(out(f.root), "011-osd-tmp-zosd-h4-c", ".abapgit.xml"), "utf8")).to.equal(ABAPGIT_XML);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("a cycle group is one folder, the members' src merged, and the manifest says so", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-x", "$ZOSD_H4_X", 3, [["zosd_h4_x.prog.abap", "REPORT zosd_h4_x.\n"]]);
      f.layer("osd-tmp-zosd-h4-y", "$ZOSD_H4_Y", 4, [["zosd_h4_y.prog.abap", "REPORT zosd_h4_y.\n"]]);
      f.plan({cycles: [["osd-tmp-zosd-h4-x", "osd-tmp-zosd-h4-y"]]});
      expect(await run(["--layers", f.root, "--out", out(f.root)])).to.equal(0);
      // one folder at the smallest member's order; no folder per member
      expect(readdirSync(out(f.root)).sort()).to.deep.equal([
        "003-cycle-osd-tmp-zosd-h4-x+osd-tmp-zosd-h4-y", "manifest.json"]);
      const merged = join(out(f.root), "003-cycle-osd-tmp-zosd-h4-x+osd-tmp-zosd-h4-y");
      expect(readFileSync(join(merged, "src", "zosd_h4_x.prog.abap"), "utf8")).to.equal("REPORT zosd_h4_x.\n");
      expect(readFileSync(join(merged, "src", "zosd_h4_y.prog.abap"), "utf8")).to.equal("REPORT zosd_h4_y.\n");
      expect(readFileSync(join(merged, ".abapgit.xml"), "utf8")).to.equal(ABAPGIT_XML);
      const manifest = JSON.parse(readFileSync(join(out(f.root), "manifest.json"), "utf8"));
      expect(manifest.layers).to.deep.equal([{
        name: "cycle-osd-tmp-zosd-h4-x+osd-tmp-zosd-h4-y", package: null, order: 3, objects: {PROG: 2},
        cycle: ["osd-tmp-zosd-h4-x", "osd-tmp-zosd-h4-y"],
      }]);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("--packages filters by plan package and refuses a pattern that names nothing", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-keep", "$ZOSD_H4_KEEP", 0, [["zosd_h4_keep.prog.abap", "REPORT zosd_h4_keep.\n"]]);
      f.layer("osd-tmp-zosd-h4-drop", "$ZOSD_H4_DROP", 1, [["zosd_h4_drop.prog.abap", "REPORT zosd_h4_drop.\n"]]);
      f.plan();
      expect(await run(["--layers", f.root, "--packages", "$ZOSD_H4_K%", "--out", out(f.root)])).to.equal(0);
      expect(readdirSync(out(f.root)).sort()).to.deep.equal(["000-osd-tmp-zosd-h4-keep", "manifest.json"]);
      const manifest = JSON.parse(readFileSync(join(out(f.root), "manifest.json"), "utf8"));
      expect(manifest.layers.map((l) => l.package)).to.deep.equal(["$ZOSD_H4_KEEP"]);
      let refused;
      try {
        await run(["--layers", f.root, "--packages", "$ZOSD_H4_NONE", "--out", join(f.root, "none")]);
        expect.fail("a pattern that names no layer must refuse");
      } catch (error) {
        refused = error;
      }
      expect(refused.message).to.match(/no layer matches --packages \$ZOSD_H4_NONE/);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("a layer folder without .abapgit.xml is refused", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
      f.plan();
      unlinkSync(join(f.root, "layers", "osd-tmp-zosd-h4-a", ".abapgit.xml"));
      let refused;
      try {
        await run(["--layers", f.root, "--out", out(f.root)]);
        expect.fail("a layer without .abapgit.xml must refuse");
      } catch (error) {
        refused = error;
      }
      expect(refused.message).to.match(/osd-tmp-zosd-h4-a.*has no \.abapgit\.xml/);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("nested folders in a layer are refused", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
      f.plan();
      mkdirSync(join(f.root, "layers", "osd-tmp-zosd-h4-a", "src", "nested"), {recursive: true});
      writeFileSync(join(f.root, "layers", "osd-tmp-zosd-h4-a", "src", "nested", "zosd_h4_n.prog.abap"), "REPORT zosd_h4_n.\n");
      let refused;
      try {
        await run(["--layers", f.root, "--out", out(f.root)]);
        expect.fail("a nested folder must refuse");
      } catch (error) {
        refused = error;
      }
      expect(refused.message).to.match(/nested.*is a folder/);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("a layers directory inside the tree is refused unless it is under gen/ or .local/", async () => {
    const tree = mkdtempSync(join(tmpdir(), "hana-src-tree-"));
    try {
      // local/ is inside the tree and not gen/ or .local/: refused
      const local = join(tree, "local", "layers");
      mkdirSync(local, {recursive: true});
      writeFileSync(join(local, "plan.json"), "{}");
      let refused;
      try {
        await run(["--layers", local, "--out", join(tree, "gen", "out")], {root: tree});
        expect.fail("a layers directory inside the tree must refuse");
      } catch (error) {
        refused = error;
      }
      expect(refused.message).to.match(/inside this tree/);
      expect(refused.message).to.match(/gen\/ or \.local\//);
      // under gen/ the same directory is allowed, and is read
      const allowed = join(tree, "gen", "layers");
      const f = converterOutput();
      try {
        f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
        f.plan();
        rmSync(allowed, {recursive: true, force: true});
        cpSync(f.root, allowed, {recursive: true});
        expect(await run(["--layers", allowed, "--out", join(tree, "gen", "hana-src")], {root: tree})).to.equal(0);
        expect(readdirSync(join(tree, "gen", "hana-src"))).to.include("000-osd-tmp-zosd-h4-a");
      } finally {
        rmSync(f.root, {recursive: true, force: true});
      }
    } finally {
      rmSync(tree, {recursive: true, force: true});
    }
  });

  it("the manifest carries the provenance the plan has, and only that", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
      f.plan();
      expect(await run(["--layers", f.root, "--out", out(f.root)])).to.equal(0);
      const manifest = JSON.parse(readFileSync(join(out(f.root), "manifest.json"), "utf8"));
      expect(manifest.source).to.equal(f.root);
      expect(manifest.dump).to.deep.equal({manifest_sha256: "f".repeat(64), provenance: "the H4 fixtures' own test bed"});
      expect(manifest.layers).to.deep.equal([
        {name: "osd-tmp-zosd-h4-a", package: "$ZOSD_H4_A", order: 0, objects: {PROG: 1}}]);
      expect(manifest.no_source).to.deep.equal({TABL: 1});
      expect(new Date(manifest.generated_at).toISOString()).to.equal(manifest.generated_at);
      expect("converter_commit" in manifest, "the plan carries no converter commit").to.equal(false);
      // a plan that carries one passes it through, and one without a dump
      // manifest says nothing about a dump
      f.plan({converter_commit: "abc123", dump: undefined});
      expect(await run(["--layers", f.root, "--out", out(f.root)])).to.equal(0);
      const again = JSON.parse(readFileSync(join(out(f.root), "manifest.json"), "utf8"));
      expect(again.converter_commit).to.equal("abc123");
      expect("dump" in again, "no dump provenance, no dump key").to.equal(false);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("--check exits 1 on drift and ignores generated_at", async () => {
    const f = converterOutput();
    try {
      f.layer("osd-tmp-zosd-h4-a", "$ZOSD_H4_A", 0, [["zosd_h4_a.prog.abap", "REPORT zosd_h4_a.\n"]]);
      f.layer("osd-tmp-zosd-h4-b", "$ZOSD_H4_B", 1, [["zosd_h4_b.prog.abap", "REPORT zosd_h4_b.\n"]]);
      f.plan();
      const at = out(f.root);
      expect(await run(["--layers", f.root, "--out", at])).to.equal(0);
      // a fresh --check run would write a new generated_at; it is not drift
      expect(await run(["--layers", f.root, "--check", "--out", at])).to.equal(0);
      // an edited copy is drift
      writeFileSync(join(at, "000-osd-tmp-zosd-h4-a", "src", "zosd_h4_a.prog.abap"), "REPORT edited.\n");
      expect(await run(["--layers", f.root, "--check", "--out", at])).to.equal(1);
      writeFileSync(join(at, "000-osd-tmp-zosd-h4-a", "src", "zosd_h4_a.prog.abap"), "REPORT zosd_h4_a.\n");
      // a missing folder is drift
      rmSync(join(at, "001-osd-tmp-zosd-h4-b"), {recursive: true, force: true});
      expect(await run(["--layers", f.root, "--check", "--out", at])).to.equal(1);
      expect(await run(["--layers", f.root, "--out", at])).to.equal(0);
      // an extra file on disk is drift
      writeFileSync(join(at, "001-osd-tmp-zosd-h4-b", "src", "zosd_h4_extra.prog.abap"), "REPORT zosd_h4_extra.\n");
      expect(await run(["--layers", f.root, "--check", "--out", at])).to.equal(1);
      // no gen/hana-src at all is drift, and says so
      const empty = join(f.root, "never-written");
      expect(await run(["--layers", f.root, "--check", "--out", empty])).to.equal(1);
    } finally {
      rmSync(f.root, {recursive: true, force: true});
    }
  });

  it("the folders are layers before src/, and a src/ file of the same name wins", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-src-layers-"));
    const write = (rel, body) => {
      mkdirSync(join(root, rel.split("/").slice(0, -1).join("/")), {recursive: true});
      writeFileSync(join(root, rel), body);
    };
    try {
      write("abap_transpile.json", JSON.stringify({input_folder: ["gen/hana-ddic", "gen/hana-src/*", "src", "gen"]}));
      write("gen/hana-src/000-osd-tmp-zosd-h4-a/.abapgit.xml", ABAPGIT_XML);
      write("gen/hana-src/000-osd-tmp-zosd-h4-a/src/zosd_h4_prog.prog.abap", "REPORT generated.\n");
      write("gen/hana-src/001-osd-tmp-zosd-h4-b/.abapgit.xml", ABAPGIT_XML);
      write("gen/hana-src/001-osd-tmp-zosd-h4-b/src/zosd_h4_keep.prog.abap", "REPORT zosd_h4_keep.\n");
      write("src/zosd_h4_prog.prog.abap", "REPORT hand-written wins.\n");
      write("gen/hana-ddic/zosd_h4_tab.tabl.xml", "<abapGit><TABNAME>ZOSD_H4_TAB</TABNAME></abapGit>");
      write("gen/zosd_h4_gen.tabl.xml", "<abapGit><TABNAME>ZOSD_H4_GEN</TABNAME></abapGit>");
      const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
      const stack = layers(root, config);
      expect(stack.folders, "one entry, the children as layers, before src/").to.deep.equal([
        "gen/hana-ddic", "gen/hana-src/000-osd-tmp-zosd-h4-a", "gen/hana-src/001-osd-tmp-zosd-h4-b", "src", "gen"]);
      expect(stack.owner.get("PROG ZOSD_H4_PROG"), "the hand-written src/ file wins").to.equal("src");
      expect(stack.hidden).to.deep.equal(["gen/hana-src/000-osd-tmp-zosd-h4-a/src/zosd_h4_prog.prog.abap"]);
      expect(stack.owner.get("PROG ZOSD_H4_KEEP")).to.equal("gen/hana-src/001-osd-tmp-zosd-h4-b");
      expect(stack.owner.get("TABL ZOSD_H4_TAB")).to.equal("gen/hana-ddic");
      expect(stack.owner.get("TABL ZOSD_H4_GEN")).to.equal("gen");
      expect(stack.duplicates).to.deep.equal([]);
      expect(stack.total, "each object counted once; the repository marker is no object").to.equal(4);
      expect([...stack.owner.keys()].filter((o) => o.startsWith("ABAPGIT")), "no phantom object from .abapgit.xml")
        .to.deep.equal([]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("expandedFolders: one entry, the children as layers", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-src-expand-"));
    const write = (rel, body = "") => {
      mkdirSync(join(root, rel.split("/").slice(0, -1).join("/")), {recursive: true});
      writeFileSync(join(root, rel), body);
    };
    try {
      write("gen/hana-src/002-osd-tmp-zosd-h4-b/src/zosd_h4_b.prog.abap");
      write("gen/hana-src/001-osd-tmp-zosd-h4-a/src/zosd_h4_a.prog.abap");
      write("gen/hana-src/manifest.json", "{}");
      // the children in name order (the zero padding is the plan order), the
      // parent's own files not expanded, the plain entry carried through
      expect(expandedFolders(["gen/hana-src/*", "src"], root)).to.deep.equal([
        "gen/hana-src/001-osd-tmp-zosd-h4-a", "gen/hana-src/002-osd-tmp-zosd-h4-b", "src"]);
      // a parent that is not there yields nothing, like a missing input folder
      expect(expandedFolders(["gen/hana-absent/*"], root)).to.deep.equal([]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
