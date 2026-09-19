// A generation is addressed by the hash of its inputs, so a name means one
// set of bytes (backlog B.9).
//
// `--force` used to build again and replace the directory, so a consumer
// pinned to `<hash>` saw different content under an unchanged name -- the
// thing immutability was for. It builds, compares and reports now, and
// refuses to overwrite unless asked in so many words.
//
// Measured before any of this was written, because the answer was not known:
// two forced builds of one generation differed in **1 of 2249 files**, and
// the cause was single -- the builder's own process id, baked into the copy
// of `abap_transpile.json` the generation carries (`output_folder`:
// `build/tmp/<hash>.<pid>/output`). An artefact addressed by the hash of its
// inputs must not carry the number of the process that wrote it. With that
// removed the build is byte for byte reproducible, twice in a row.
import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compareGenerations, MANIFEST_VOLATILE} from "../tools/osd-generation-diff.mjs";

function generation(files) {
  const dir = mkdtempSync(join(tmpdir(), "gen-"));
  for (const [path, content] of Object.entries(files)) {
    const at = join(dir, path);
    mkdirSync(join(at, ".."), {recursive: true});
    writeFileSync(at, content);
  }
  return dir;
}

const manifest = (extra = {}) => JSON.stringify({hash: "abc", objects: 12, ms: 100, builtAt: "x", ...extra});

describe("two generations of one name, compared byte for byte", () => {
  it("identical is identical, and says how many files it read", () => {
    const files = {"output/a.mjs": "one", "output/b.mjs": "two", "manifest.json": manifest()};
    const verdict = compareGenerations(generation(files), generation(files));
    expect(verdict.same).to.equal(true);
    expect(verdict.files).to.equal(3);
    expect(verdict.collapsed, "nothing had to be collapsed").to.deep.equal([]);
  });

  it("a file whose content changed is NAMED, not counted", () => {
    const verdict = compareGenerations(
      generation({"output/a.mjs": "one", "manifest.json": manifest()}),
      generation({"output/a.mjs": "ONE", "manifest.json": manifest()}));
    expect(verdict.same).to.equal(false);
    expect(verdict.differing).to.deep.equal(["output/a.mjs"]);
  });

  it("a file present on one side only is named, and on which side", () => {
    const verdict = compareGenerations(
      generation({"output/a.mjs": "one", "manifest.json": manifest()}),
      generation({"output/a.mjs": "one", "output/b.mjs": "two", "manifest.json": manifest()}));
    expect(verdict.same).to.equal(false);
    expect(verdict.onlyInB).to.deep.equal(["output/b.mjs"]);
    expect(verdict.onlyInA).to.deep.equal([]);
  });

  // The one file allowed to differ, and only in fields that are about the
  // build rather than about its output.
  it("the manifest may differ in how long it took and when -- and says it collapsed them", () => {
    const verdict = compareGenerations(
      generation({"manifest.json": manifest({ms: 100, builtAt: "monday"})}),
      generation({"manifest.json": manifest({ms: 900, builtAt: "friday"})}));
    expect(verdict.same).to.equal(true);
    expect(verdict.collapsed[0], "'identical' and 'identical after collapsing two fields' are different claims")
      .to.contain("manifest.json");
  });

  it("but NOT in what it built, which is the output under another name", () => {
    const verdict = compareGenerations(
      generation({"manifest.json": manifest({objects: 12})}),
      generation({"manifest.json": manifest({objects: 13})}));
    expect(verdict.same).to.equal(false);
    expect(verdict.differing).to.deep.equal(["manifest.json"]);
  });

  it("every field allowed to differ carries a reason", () => {
    for (const [field, why] of Object.entries(MANIFEST_VOLATILE)) {
      expect(why, field).to.be.a("string").and.have.length.greaterThan(10);
    }
  });

  it("a symlink is not content, so the roots linked into a generation are skipped", () => {
    const a = generation({"output/a.mjs": "one", "manifest.json": manifest()});
    const b = generation({"output/a.mjs": "one", "manifest.json": manifest()});
    symlinkSync("/nowhere/at/all", join(a, "src"));
    symlinkSync("/somewhere/else", join(b, "src"));
    expect(compareGenerations(a, b).same, "the link targets differ and neither is content").to.equal(true);
  });

  it("a generation that is not there is a difference, not a crash", () => {
    const verdict = compareGenerations("/nowhere/at/all", generation({"manifest.json": manifest()}));
    expect(verdict.same).to.equal(false);
    expect(verdict.missing).to.contain("nowhere");
  });
});
