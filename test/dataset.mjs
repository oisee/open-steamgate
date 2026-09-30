// X0: OPEN / READ / TRANSFER DATASET against the sandboxed disk
// (tools/osd-dataset.mjs, docs/dataset.md). The runtime owns the ABAP side
// and is tested in the transpiler; what is ours is the host, so this drives
// the runtime's statements straight over it: deny by default, the roots,
// escapes by .. and by symlink, a write to a read-only root, the audit log,
// a binary round trip, text lines at the 64 KiB read boundary.
import {expect} from "chai";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ABAP} from "@abaplint/runtime";
import {sandboxDatasetHost, memoryDatasetHost, rootsOf} from "../tools/osd-dataset.mjs";

const abap = new ABAP();
globalThis.abap ??= abap;
const run = globalThis.abap;
const T = run.types;

const str = (v) => new T.String().set(v);
const subrc = () => run.builtin.sy.get().subrc.get();

async function open(name, mode, binary = true, message) {
  await run.statements.openDataset(str(name), {mode, binary, encoding: binary ? undefined : "UTF-8", message});
  return subrc();
}

describe("DATASET host (X0)", function () {
  let base;
  let readRoot;
  let writeRoot;
  let outside;
  let audit;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "osd-dataset-"));
    readRoot = join(base, "in");
    writeRoot = join(base, "out");
    outside = join(base, "elsewhere");
    for (const d of [readRoot, writeRoot, outside]) {
      mkdirSync(d);
    }
    writeFileSync(join(readRoot, "a.txt"), "one\ntwo\n");
    writeFileSync(join(outside, "secret.txt"), "no\n");
    audit = [];
    run.context.datasets = {};
    run.context.dataset = sandboxDatasetHost({read: [readRoot], write: [writeRoot], audit: (e) => audit.push(e)});
  });

  afterEach(() => {
    run.context.dataset = undefined;
    run.context.datasets = {};
    rmSync(base, {recursive: true, force: true});
  });

  it("with no root, everything is refused: sy-subrc 8 and a MESSAGE", async () => {
    run.context.dataset = sandboxDatasetHost({});
    const message = str("");
    expect(await open(join(readRoot, "a.txt"), "INPUT", true, message)).to.equal(8);
    expect(message.get()).to.contain("Permission denied");
  });

  it("reads inside a read root, and refuses to write there", async () => {
    const line = str("");
    expect(await open(join(readRoot, "a.txt"), "INPUT", false)).to.equal(0);
    await run.statements.readDataset(str(join(readRoot, "a.txt")), line);
    expect(line.get()).to.equal("one");
    await run.statements.closeDataset(str(join(readRoot, "a.txt")));
    expect(await open(join(readRoot, "new.txt"), "OUTPUT")).to.equal(8);
    expect(existsSync(join(readRoot, "new.txt"))).to.equal(false);
    await run.statements.deleteDataset(str(join(readRoot, "a.txt")));
    expect(subrc()).to.equal(4);
    expect(existsSync(join(readRoot, "a.txt"))).to.equal(true);
  });

  it("a .. that leaves the roots is refused", async () => {
    expect(await open(join(readRoot, "..", "elsewhere", "secret.txt"), "INPUT")).to.equal(8);
    expect(await open(join(writeRoot, "..", "elsewhere", "x.txt"), "OUTPUT")).to.equal(8);
    expect(existsSync(join(outside, "x.txt"))).to.equal(false);
  });

  it("a symlink inside a root that points out of it is refused, for reading and for writing", async () => {
    symlinkSync(join(outside, "secret.txt"), join(readRoot, "link.txt"));
    symlinkSync(outside, join(writeRoot, "dir"));
    expect(await open(join(readRoot, "link.txt"), "INPUT")).to.equal(8);
    expect(await open(join(writeRoot, "dir", "planted.txt"), "OUTPUT")).to.equal(8);
    expect(existsSync(join(outside, "planted.txt"))).to.equal(false);
  });

  it("a name that is only a prefix of a root is not inside it", async () => {
    mkdirSync(readRoot + "2");
    writeFileSync(join(readRoot + "2", "b.txt"), "b\n");
    expect(await open(join(readRoot + "2", "b.txt"), "INPUT")).to.equal(8);
  });

  it("a missing file is sy-subrc 8 with the system's text", async () => {
    const message = str("");
    expect(await open(join(readRoot, "none.txt"), "INPUT", true, message)).to.equal(8);
    expect(message.get()).to.equal("No such file or directory");
  });

  it("a binary round trip through a write root", async () => {
    const name = str(join(writeRoot, "b.bin"));
    await open(name.get(), "OUTPUT");
    await run.statements.transfer(new T.XString().set("00FF0D0A41"), name);
    await run.statements.closeDataset(name);
    expect(readFileSync(join(writeRoot, "b.bin")).toString("hex").toUpperCase()).to.equal("00FF0D0A41");
    await open(name.get(), "INPUT");
    const back = new T.XString();
    await run.statements.readDataset(name, back);
    expect(back.get()).to.equal("00FF0D0A41");
    await run.statements.closeDataset(name);
  });

  it("APPENDING writes at the end on disk", async () => {
    writeFileSync(join(writeRoot, "log.txt"), "x\n");
    const name = str(join(writeRoot, "log.txt"));
    await open(name.get(), "APPENDING", false);
    await run.statements.transfer(str("y"), name);
    await run.statements.closeDataset(name);
    expect(readFileSync(join(writeRoot, "log.txt"), "utf8")).to.equal("x\ny\n");
  });

  it("text lines across the 64 KiB read boundary keep their length, and ACTUAL LENGTH counts them", async () => {
    const chunk = 64 * 1024;
    const lines = ["a".repeat(chunk - 1), "b".repeat(chunk), "c".repeat(chunk * 2 + 3), "tail"];
    writeFileSync(join(readRoot, "long.txt"), lines.join("\n"));
    const name = str(join(readRoot, "long.txt"));
    await open(name.get(), "INPUT", false);
    for (const want of lines) {
      const line = str("");
      const length = new T.Integer();
      await run.statements.readDataset(name, line, {actualLength: length});
      expect(subrc()).to.equal(0);
      expect(length.get()).to.equal(want.length);
      expect(line.get()).to.equal(want);
    }
    await run.statements.readDataset(name, str(""));
    expect(subrc()).to.equal(4);
    await run.statements.closeDataset(name);
  });

  it("a relative name resolves against the first write root", async () => {
    await open("rel.txt", "OUTPUT", false);
    await run.statements.transfer(str("r"), str("rel.txt"));
    await run.statements.closeDataset(str("rel.txt"));
    expect(readFileSync(join(writeRoot, "rel.txt"), "utf8")).to.equal("r\n");
  });

  it("every OPEN and DELETE is in the audit log, allowed or not", async () => {
    await open(join(readRoot, "a.txt"), "INPUT");
    await run.statements.closeDataset(str(join(readRoot, "a.txt")));
    await open(join(outside, "secret.txt"), "INPUT");
    await run.statements.deleteDataset(str(join(writeRoot, "none.txt")));
    expect(audit.map((e) => [e.op, e.allowed])).to.deep.equal([["OPEN", true], ["OPEN", false], ["DELETE", false]]);
  });

  it("the roots come from a delimited list, blanks dropped", () => {
    expect(rootsOf(" /a : /b ::")).to.deep.equal(["/a", "/b"]);
    expect(rootsOf(undefined)).to.deep.equal([]);
  });

  it("the memory host behaves like the disk for the preview", async () => {
    const host = memoryDatasetHost();
    run.context.dataset = host;
    const name = str("/mem/f.txt");
    await open(name.get(), "OUTPUT", false);
    await run.statements.transfer(str("m"), name);
    await run.statements.closeDataset(name);
    expect(new TextDecoder().decode(host.files.get("/mem/f.txt"))).to.equal("m\n");
  });
});
