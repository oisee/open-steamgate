import {expect} from "chai";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BadPack, contentFoldersOf, dataDirsOf, ddicDirsOf, inputFoldersOf, packAt, packRootsOf, packsOf, webappsOf} from "../tools/osd-packs.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

// A pack is a directory, not a rebuild (backlog E.2): ABAP, seed rows, a
// page and a manifest naming it, found at start and layered after the tree's
// own folders. Nothing here is compiled in, so these tests build packs on
// disk and ask what OSD makes of them.
describe("tools/osd-packs: a pack is a directory", () => {
  let root;
  let outside;
  const write = (file, text = "") => {
    mkdirSync(join(root, file, ".."), {recursive: true});
    writeFileSync(join(root, file), text);
  };
  const CLASS = (name) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-packs-"));
    outside = mkdtempSync(join(tmpdir(), "osd-elsewhere-"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen"]}));
    write("src/zcl_ours.clas.abap", CLASS("zcl_ours"));
    write("packs/vibes/osd-pack.json", JSON.stringify({description: "the worked example"}));
    write("packs/vibes/src/zcl_theirs.clas.abap", CLASS("zcl_theirs"));
    write("packs/vibes/src/ddic/ztheirs.tabl.xml", "<abapGit/>");
    write("packs/vibes/data/ztheirs.tabu.json", "[]");
    write("packs/vibes/webapp/index.html", "<h1>hello</h1>");
    write("packs/notapack/src/zcl_ignored.clas.abap", CLASS("zcl_ignored"));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
  });

  it("reads a directory with a manifest, and takes its name and its folders from what is there", () => {
    const packs = packsOf(root, {});
    expect(packs.map((p) => p.name)).to.deep.equal(["vibes"]);
    const [pack] = packs;
    expect(pack.description).to.equal("the worked example");
    expect(pack.package, "a pack is a package of its own").to.equal("$VIBES");
    expect(pack.order).to.equal(100);
    expect(pack.abap.map((f) => f.endsWith(join("packs", "vibes", "src")))).to.deep.equal([true]);
    expect(pack.data.endsWith(join("packs", "vibes", "data"))).to.equal(true);
    expect(pack.webapp.endsWith(join("packs", "vibes", "webapp"))).to.equal(true);
    expect(pack.ddic.endsWith(join("src", "ddic"))).to.equal(true);
  });

  it("a directory with no manifest is not a pack, however much it looks like one", () => {
    expect(packAt(root, join(root, "packs", "notapack"))).to.equal(undefined);
    expect(packsOf(root, {}).map((p) => p.name)).to.not.include("notapack");
  });

  it("a manifest that will not parse says which file and why", () => {
    writeFileSync(join(root, "packs", "vibes", "osd-pack.json"), "{not json");
    expect(() => packsOf(root, {})).to.throw(BadPack).with.property("code", "BAD_PACK");
  });

  it("layers after the folders the config lists, so a pack wins a name it shares", () => {
    const config = {input_folder: ["src", "gen"]};
    const folders = inputFoldersOf(root, config, {});
    expect(folders.slice(0, 2)).to.deep.equal(["src", "gen"]);
    expect(folders).to.have.length(3);
    expect(folders[2].split("/").slice(-3).join("/")).to.equal("packs/vibes/src");
  });

  it("orders by the manifest, then by name", () => {
    write("packs/early/osd-pack.json", JSON.stringify({order: 10}));
    write("packs/early/src/zcl_early.clas.abap", CLASS("zcl_early"));
    write("packs/also/osd-pack.json", JSON.stringify({}));
    write("packs/also/src/zcl_also.clas.abap", CLASS("zcl_also"));
    expect(packsOf(root, {}).map((p) => p.name)).to.deep.equal(["early", "also", "vibes"]);
  });

  it("finds a pack outside the tree, named on its own or by the directory that holds it", () => {
    mkdirSync(join(outside, "away", "src"), {recursive: true});
    writeFileSync(join(outside, "away", "osd-pack.json"), JSON.stringify({name: "away"}));
    writeFileSync(join(outside, "away", "src", "zcl_away.clas.abap"), CLASS("zcl_away"));
    expect(packsOf(root, {OSD_PACKS: join(outside, "away")}).map((p) => p.name)).to.deep.equal(["away", "vibes"]);
    expect(packsOf(root, {OSD_PACKS: outside}).map((p) => p.name)).to.deep.equal(["away", "vibes"]);
    // the same pack reached two ways is one pack
    expect(packsOf(root, {OSD_PACKS: `${outside}:${join(outside, "away")}`}).map((p) => p.name)).to.deep.equal(["away", "vibes"]);
  });

  it("brings its seed rows, its table definitions and its page", () => {
    expect(dataDirsOf(root, {}).map((d) => d.split("/").slice(-2).join("/"))).to.deep.equal(["vibes/data"]);
    expect(ddicDirsOf(root, {}).some((d) => d.includes(join("packs", "vibes")))).to.equal(true);
    expect(webappsOf(root, {})).to.have.length(1);
    expect(webappsOf(root, {})[0].name).to.equal("vibes");
  });

  it("a generator reads content, not every layer: the tree's src and each pack", () => {
    const folders = contentFoldersOf(root, {});
    expect(folders[0]).to.equal("src");
    expect(folders).to.have.length(2);
    expect(folders[1].endsWith("packs/vibes/src")).to.equal(true);
  });

  it("the object store shows a pack's objects, in the pack's own package", () => {
    const store = new ObjectStore({root, libs: []});
    const entry = store.find("CLAS", "ZCL_THEIRS");
    expect(entry, "the pack's class is an object of the system").to.not.equal(undefined);
    expect(entry.package).to.equal("$VIBES");
    expect(entry.writable).to.equal(true);
    expect(store.rootPackages().map((p) => p.name)).to.include("$VIBES");
    expect(store.find("CLAS", "ZCL_IGNORED"), "a folder without a manifest is in nobody's tree").to.equal(undefined);
  });

  it("the roots a pack adds carry the package, so nothing guesses it from the folder name", () => {
    const roots = packRootsOf(root, {});
    expect(roots).to.have.length(1);
    expect(roots[0]).to.include({package: "$VIBES", pack: "vibes", writable: true});
    expect(roots[0].path.endsWith("packs/vibes/src")).to.equal(true);
  });
});
