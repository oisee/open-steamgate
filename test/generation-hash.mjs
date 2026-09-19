import {expect} from "chai";
import {writeFileSync, readFileSync, rmSync, mkdirSync} from "node:fs";
import {join} from "node:path";
import {hashOf, generatorClosure} from "../tools/osd-build.mjs";

// **A generation's name was a function of the tree AND of how many times the
// tree had been built.**
//
// `gen/` was one of the hashed input folders and is written BY the build, so
// the first build of a fresh tree hashed an empty `gen/` and the second
// hashed the one the first had just written. Two builds, no edit between
// them, two different names -- measured from both sessions independently:
//
//   before   build 1 -> 134909ac…, build 2 -> 910a2f11…, build 3 -> cache
//   after    build 1 -> 93addd64…, build 2 -> cache (0.16 s)
//
// The cause was `NOT_AN_INPUT` excluding `.mjs`: a generator's own code was
// not an input while its output was, so the hash watched the representative
// and not the thing represented. The representative is gone and the thing
// represented -- the generators and everything they import -- is hashed.
describe("a generation's name is a function of the tree, not of its build history", () => {
  it("a change under gen/ does not rename the generation, because gen/ is an output", () => {
    const before = hashOf(process.cwd());
    const probe = join("gen", "osd-hash-probe.tmp.abap");
    mkdirSync("gen", {recursive: true});
    writeFileSync(probe, "* written by a test, and gen/ is an output\n");
    try {
      expect(hashOf(process.cwd()), "gen/ is written by the build; hashing it made the name self-referential")
        .to.equal(before);
    } finally {
      rmSync(probe, {force: true});
    }
  });

  it("but a change to a generator DOES, because that is what decides gen/", () => {
    const before = hashOf(process.cwd());
    const closure = generatorClosure();
    const victim = closure.find((f) => f.endsWith("cds2ddic.mjs"));
    expect(victim, "cds2ddic is a generator").to.be.a("string");
    const original = readFileSync(victim);
    try {
      writeFileSync(victim, Buffer.concat([original, Buffer.from("\n// probe\n")]));
      expect(hashOf(process.cwd()), "the thing represented has to be watched").to.not.equal(before);
    } finally {
      writeFileSync(victim, original);
    }
    expect(hashOf(process.cwd()), "and restored is restored").to.equal(before);
  });

  it("the closure is the generators and what they import, not every tool there is", () => {
    const closure = generatorClosure();
    const names = closure.map((f) => f.split("/").pop());
    expect(names, "a listed generator").to.contain("cds2ddic.mjs");
    expect(names, "something a generator imports").to.contain("osd-packs.mjs");
    // editing a tool no generator reaches must not rename every generation
    expect(names).to.not.contain("osd-sql-trace-buffer.mjs");
    expect(closure.length, "a subset, computed rather than approximated by `all of tools/`")
      .to.be.lessThan(60);
  });

  it("and the closure is stable, so the hash does not depend on the order it was read", () => {
    expect(generatorClosure()).to.deep.equal(generatorClosure());
    expect([...generatorClosure()], "sorted").to.deep.equal([...generatorClosure()].sort());
  });
});
