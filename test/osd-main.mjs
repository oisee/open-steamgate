import {expect} from "chai";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {runsAs} from "../tools/osd-main.mjs";

// **A main-guard that reads `import.meta.url` is a bug in a bundle.**
//
// Every module of a compiled Bun binary shares one `import.meta.url`
// (CLAUDE.md records it; it is why bin/osd.mjs restores renamed class names).
// The guard these tools used --
//   process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())
// -- is therefore true in EVERY module inside the binary, because the shared
// url ends in "/osd" and argv[1] is the binary. The first such module the
// bundle evaluates runs its own main() and the binary becomes that tool:
// measured 2026-09-19, `build/osd doctor` answered "no packs: nothing in
// packs", tools/osd-packs.mjs having taken the process over and read
// "doctor" as a directory.
//
// So the name is a literal, and this test is the thing that keeps it that
// way -- a rule in a comment would be re-derived by the next person writing
// a tool with a `main()`.
describe("a tool knows whether the command line named it", () => {
  it("says yes only for its own file name", () => {
    const argv = process.argv[1];
    try {
      process.argv[1] = "/wherever/tools/osd-packs.mjs";
      expect(runsAs("osd-packs.mjs")).to.equal(true);
      expect(runsAs("osd-build.mjs")).to.equal(false);
      // the binary: argv[1] is the binary itself, and no tool is it
      process.argv[1] = "/home/someone/dev/open-steamgate/build/osd";
      expect(runsAs("osd-packs.mjs"), "inside the binary no tool is the entry").to.equal(false);
      expect(runsAs("osd-build.mjs")).to.equal(false);
      process.argv[1] = undefined;
      expect(runsAs("osd-packs.mjs")).to.equal(false);
    } finally {
      process.argv[1] = argv;
    }
  });

  it("and no tool carries the form that cannot tell, because in a bundle it is always true", () => {
    const dir = join(process.cwd(), "tools");
    const offenders = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
      // the helper quotes the bad form in its own comment, to say what it
      // replaces -- a scan that reads whole files finds its confirmation in
      // its own explanation, which is how this test first went red
      if (name === "osd-main.mjs") continue;
      const source = readFileSync(join(dir, name), "utf8");
      if (/import\.meta\.url\.endsWith\(/.test(source)
          || /argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)/.test(source)) {
        offenders.push(name);
      }
    }
    expect(offenders, `use runsAs("<file>.mjs") from tools/osd-main.mjs: ${offenders.join(", ")}`)
      .to.deep.equal([]);
  });
});
