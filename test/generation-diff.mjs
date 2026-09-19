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
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compareGenerations, MANIFEST_VOLATILE, snapshotOf, changedSince} from "../tools/osd-generation-diff.mjs";

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

// What a build REWROTE under `gen/`, which is a different population from
// what a generation holds.
//
// A generation directory carries `output/` and the manifest and **no
// `gen/`**: the generated ABAP is an input to the transpile, not part of its
// result. So `compareGenerations` answers "which modules changed" and a
// screen activating a CDS view is asking "which objects were regenerated".
//
// Measured on a published view, and it corrected the number I had given:
//
//   a label changed        3 files rewritten
//   a field renamed        7 files rewritten
//
// Fourteen is what such a view OWNS. What an edit rewrites depends on the
// edit, which is exactly why the screen wants a list and not a count.
describe("what a build rewrote, as a list rather than a number", () => {
  const tree = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "gen-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), {recursive: true});
      writeFileSync(join(dir, path), content);
    }
    return dir;
  };

  it("names what changed and counts what did not", () => {
    const dir = tree({"a/one.abap": "1", "a/two.abap": "2", "b/three.abap": "3"});
    const before = snapshotOf(dir);
    writeFileSync(join(dir, "a/two.abap"), "CHANGED");
    const d = changedSince(before, dir);
    expect(d.written).to.deep.equal(["a/two.abap"]);
    expect(d.unchanged, "the ones a screen must not list").to.equal(2);
  });

  it("names a file that appeared and one that went", () => {
    const dir = tree({"keep.abap": "k", "gone.abap": "g"});
    const before = snapshotOf(dir);
    rmSync(join(dir, "gone.abap"));
    writeFileSync(join(dir, "new.abap"), "n");
    const d = changedSince(before, dir);
    expect(d.written).to.deep.equal(["new.abap"]);
    expect(d.removed, "an object the generation no longer produces").to.deep.equal(["gone.abap"]);
  });

  it("compares CONTENT, so a rebuild that changes nothing lists nothing", () => {
    const dir = tree({"a.abap": "same"});
    const before = snapshotOf(dir);
    writeFileSync(join(dir, "a.abap"), "same");
    expect(changedSince(before, dir).written, "a rewritten file with the same bytes is not a change")
      .to.deep.equal([]);
  });

  it("skips symlinks, because a link is not content", () => {
    const dir = tree({"a.abap": "x"});
    symlinkSync("/nowhere", join(dir, "link"));
    expect([...snapshotOf(dir).keys()]).to.deep.equal(["a.abap"]);
  });

  it("a directory that is not there is empty rather than a crash", () => {
    expect(snapshotOf("/nowhere/at/all").size).to.equal(0);
  });
});
