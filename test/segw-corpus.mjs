// Our generator against real exports, not against our other implementation.
//
// There is a test holding tools/segw-gen.mjs and zcl_stg_segw_gen
// byte-identical, and it is a good test, and it passed for months while both
// wrote an object name two characters too long. It compares the two
// implementations with each other. **A test that two implementations agree is
// not a test that either is right**, and the day that cost us, the right
// answer was already in the tree: real exports under .local/corpus-sap (from
// A4H) and .local/corpus (from other people's public repositories).
//
// So this suite asks the corpus. It is skipped where the corpus is not
// cloned -- and skipped out loud, because a suite that silently passes on an
// empty corpus is the false green this project keeps paying for.
import {expect} from "chai";
import {existsSync, readdirSync, statSync} from "node:fs";
import {basename, join} from "node:path";

const ROOTS = [".local/corpus-sap", ".local/corpus"].filter(existsSync);

/** every file of one extension anywhere under the corpora */
function corpusFiles(ext) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(ext)) out.push(full);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

// Measured 2026-09-19, and three ways: a real abapGit export of
// S_APS_ODATA_GBT_NTE off A4H, the ADT URIs of /DMO/ objects, and every file
// in both corpora. The corpus is the one that generalises, because it is 48
// files and not three.
const EXPECTED = {".iwsv.xml": 39, ".iwmo.xml": 36, ".iwvb.xml": 36};

describe("the SEGW file names a real system writes", () => {
  if (ROOTS.length === 0) {
    it("needs a corpus, and does not pretend otherwise", function () {
      this.skip();
    });
    return;
  }

  for (const [ext, width] of Object.entries(EXPECTED)) {
    it(`every real ${ext} name is ${width} characters, with no exception`, () => {
      const files = corpusFiles(ext);
      expect(files.length, `no ${ext} in the corpus: this assertion would pass on nothing`)
        .to.be.greaterThan(0);
      const widths = new Map();
      for (const f of files) {
        const key = basename(f, ext);
        widths.set(key.length, (widths.get(key.length) ?? 0) + 1);
      }
      expect([...widths.keys()].sort((a, b) => a - b),
        `${files.length} files, widths seen: ${JSON.stringify([...widths])}`)
        .to.deep.equal([width]);
    });
  }

  it("and our own generator writes the same widths", async () => {
    const {compile} = await import("../tools/stg-compile.mjs");
    const {readFileSync} = await import("node:fs");
    const result = compile(readFileSync("src/demo/zstg_demo.stg.yaml", "utf8"));
    const seen = Object.keys(result.files).filter((f) => /\.iw(sv|mo|vb)\.xml$/.test(f));
    expect(seen.length, "the demo produced no versioned object at all").to.be.greaterThan(0);
    for (const f of seen) {
      const ext = /(\.iw(?:sv|mo|vb)\.xml)$/.exec(f)[1];
      expect(basename(f, ext).length, `${f} is the wrong width for ${ext}`)
        .to.equal(EXPECTED[ext]);
    }
  });

  it("and a rename keeps them, which is where they were actually lost", async () => {
    // The generator was right and the check was pointed at it. What broke
    // was the rename that builds a deployment package: ZSTG_ -> ZOSD_005_
    // is four characters longer, a text rename leaves the padding alone,
    // and A4H answered "File not found: zosd_005_demo_srv 0.iwsv.xml /
    // This syntax cannot be used for an object name" (2026-09-19). A width
    // is not decoration; it is part of the name.
    const {renameFile} = await import("../tools/osd-rename.mjs");
    const cases = [
      ["zstg_demo_srv                      0001.iwsv.xml", ".iwsv.xml", 39],
      ["zstg_demo_mdl                   0001.iwmo.xml", ".iwmo.xml", 36],
    ];
    for (const [name, ext, width] of cases) {
      for (const to of ["ZOSD_005_", "ZX_", "ZSTG_"]) {
        const out = renameFile(name, "ZSTG_", to);
        expect(out.endsWith(ext), out).to.equal(true);
        expect(out.length - ext.length, `${out} after ZSTG_ -> ${to}`).to.equal(width);
      }
    }
    // a name that is not versioned is renamed and not padded
    expect(renameFile("zcl_zstg_demo_mpc.clas.abap", "ZSTG_", "ZOSD_005_")).to.equal("zcl_zosd_005_demo_mpc.clas.abap");
  });

  it("the widths differ by type, which is the thing one measurement hides", () => {
    // IWSV is not IWMO. Measuring three IWMO objects, finding 32 and applying
    // it to both fixed one and broke the other -- and edited a fixture that
    // had been right since somebody copied it off a real export.
    expect(EXPECTED[".iwsv.xml"]).to.not.equal(EXPECTED[".iwmo.xml"]);
  });
});

// A symbol with no pool entry is a silent empty label.
//
// Not hypothetical, and not ours: SAP's own `cl_uconhttp_mpc` calls
// `set_label_from_text_element` 37 times and its export carries neither
// <TPOOL> nor <TEXTPOOL> -- symbols 075, 076, 077 point at nothing. Nobody
// complains: abapGit imports it, the class activates, $metadata is valid,
// and the labels are simply absent. So the system offers no backstop here,
// and the shape comparison in tools/osd-metadata-diff.mjs would not notice
// either, because it compares which things exist and not what they are
// called.
//
// Which makes this the cheap check: every symbol our generator references
// must be in the pool it writes beside it.
describe("every text symbol we reference is in the pool we write", () => {
  it("the demo's MPC references nothing it did not put in the TPOOL", async () => {
    const {compile} = await import("../tools/stg-compile.mjs");
    const {readFileSync} = await import("node:fs");
    const r = compile(readFileSync("src/demo/zstg_demo.stg.yaml", "utf8"));
    const source = r.classes["zcl_zstg_demo_mpc.clas.abap"];
    const xml = r.classes["zcl_zstg_demo_mpc.clas.xml"];

    const referenced = [...source.matchAll(/iv_text_element_symbol = '([0-9A-Z]+)'/g)].map((m) => m[1]);
    const inPool = new Set([...xml.matchAll(/<KEY>([0-9A-Z]+)<\/KEY>/g)].map((m) => m[1]));

    expect(referenced.length, "no symbols at all: this assertion would pass on nothing")
      .to.be.greaterThan(0);
    const dangling = [...new Set(referenced)].filter((s) => !inPool.has(s));
    expect(dangling, `symbols referenced with no <TPOOL> entry: ${dangling.join(", ")}`)
      .to.deep.equal([]);
  });

  it("and writes no pool entry nothing refers to", async () => {
    const {compile} = await import("../tools/stg-compile.mjs");
    const {readFileSync} = await import("node:fs");
    const r = compile(readFileSync("src/demo/zstg_demo.stg.yaml", "utf8"));
    const referenced = new Set([...r.classes["zcl_zstg_demo_mpc.clas.abap"]
      .matchAll(/iv_text_element_symbol = '([0-9A-Z]+)'/g)].map((m) => m[1]));
    const pool = [...r.classes["zcl_zstg_demo_mpc.clas.xml"]
      .matchAll(/<KEY>([0-9A-Z]+)<\/KEY>/g)].map((m) => m[1]);
    const orphans = pool.filter((k) => !referenced.has(k));
    expect(orphans, `pool entries nothing references: ${orphans.join(", ")}`).to.deep.equal([]);
  });
});
