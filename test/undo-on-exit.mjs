import {expect} from "chai";
import {spawn} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

// test/helpers/undo-on-exit.mjs, exercised the way it is needed: a child
// that edits a file, registers the undo and is then interrupted before its
// own `finally` could run. The file must be back as it was.
const HELPER = pathToFileURL(new URL("./helpers/undo-on-exit.mjs", import.meta.url).pathname).href;

function child(file, how) {
  const script = `
    import {writeFileSync} from "node:fs";
    import {undoOnExit} from ${JSON.stringify(HELPER)};
    const file = ${JSON.stringify(file)};
    writeFileSync(file, "edited\\n");
    const undo = undoOnExit(() => writeFileSync(file, "original\\n"));
    const how = ${JSON.stringify(how)};
    if (how === "disposed") { undo(); process.exit(0); }
    if (how === "exit") process.exit(3);
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1000);
  `;
  return spawn(process.execPath, ["--input-type=module", "-e", script], {stdio: ["ignore", "pipe", "inherit"]});
}

function finished(proc, signal) {
  return new Promise((resolve) => {
    proc.stdout.on("data", (chunk) => {
      if (signal !== undefined && chunk.toString().includes("ready")) proc.kill(signal);
    });
    proc.on("exit", (code, received) => resolve({code, signal: received}));
  });
}

describe("a test's edit of the tree is undone when the run is interrupted", function () {
  this.timeout(20000);
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-undo-"));
    file = join(dir, "tracked.txt");
    writeFileSync(file, "original\n");
  });

  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    it(`restores the file on ${signal}, and still ends by that signal`, async () => {
      const result = await finished(child(file, "signal"), signal);
      expect(readFileSync(file, "utf8")).to.equal("original\n");
      expect(result.signal).to.equal(signal);
    });
  }

  it("restores the file when the process exits without its finally", async () => {
    const result = await finished(child(file, "exit"));
    expect(readFileSync(file, "utf8")).to.equal("original\n");
    expect(result.code).to.equal(3);
  });

  it("does nothing once the test has put things back itself", async () => {
    await finished(child(file, "disposed"));
    expect(readFileSync(file, "utf8"), "the undo was withdrawn, so the edit stays").to.equal("edited\n");
  });
});
