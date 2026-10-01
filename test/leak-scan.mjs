import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

describe("leak scanner", () => {
  const folder = mkdtempSync(join(tmpdir(), "osd-leak-vector-"));
  const packedPrivateAddress = [
    "00112233445566778899aabb", "c0", "a8", "01", "2a", "ffeeddbbccaa9988",
  ].join("");
  const privateAddress = [192, 168, 1, 42].join(".");
  const scan = (file) => spawnSync(process.execPath,
    ["tools/osd-leak-scan.mjs", ".", "--paths", file], {encoding: "utf8"});

  after(() => rmSync(folder, {recursive: true, force: true}));

  it("treats only declared embedding vector fields as opaque bytes", () => {
    const fixture = join(folder, "packs", "zvdb", "fixtures");
    mkdirSync(fixture, {recursive: true});
    const file = join(fixture, "corpus.test.json");
    writeFileSync(file, JSON.stringify({vectorHex: packedPrivateAddress, qbits: packedPrivateAddress}));
    const result = scan(file);
    assert.ok([0, 2].includes(result.status), result.stderr);
  });

  it("still decodes the same bytes in an ordinary field", () => {
    const file = join(folder, "ordinary.json");
    writeFileSync(file, JSON.stringify({payloadHex: packedPrivateAddress}));
    const result = scan(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /192\.168\.1\.42/);
  });

  it("still scans ordinary text beside an opaque vector", () => {
    const fixture = join(folder, "packs", "zvdb", "fixtures");
    mkdirSync(fixture, {recursive: true});
    const file = join(fixture, "corpus.mixed.json");
    writeFileSync(file, JSON.stringify({qbits: packedPrivateAddress, host: privateAddress}));
    const result = scan(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /частный адрес \(текст\): 192\.168\.1\.42/);
  });

  it("does not trust JSON-looking vector fields in an ordinary text file", () => {
    const file = join(folder, "vector-looking.txt");
    writeFileSync(file, JSON.stringify({qbits: packedPrivateAddress}));
    const result = scan(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /192\.168\.1\.42/);
  });

  describe("redacted output for a public log", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-leak-redact-"));
    const category = "zz secret category";
    const name = "zzleakprobename";
    mkdirSync(join(root, ".local"), {recursive: true});
    writeFileSync(join(root, ".local", "leak-identifiers.json"), JSON.stringify({[category]: [name]}));
    const file = join(root, "draft.txt");
    writeFileSync(file, `text mentioning ${name.toUpperCase()} here\n`);
    const run = (...extra) => spawnSync(process.execPath,
      ["tools/osd-leak-scan.mjs", root, ...extra], {encoding: "utf8"});
    after(() => rmSync(root, {recursive: true, force: true}));

    it("prints the name without --redact", () => {
      const result = run("--paths", file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(name));
    });

    it("prints neither the name nor its category with --redact, but still fails", () => {
      const result = run("--paths", file, "--redact");
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stderr, new RegExp(name, "i"));
      assert.doesNotMatch(result.stderr, new RegExp(category));
      assert.match(result.stderr, /категория #1 \(текст\): sha256:[0-9a-f]{8}/);
    });

    it("does not quote a malformed list", () => {
      const broken = mkdtempSync(join(tmpdir(), "osd-leak-broken-"));
      try {
        mkdirSync(join(broken, ".local"), {recursive: true});
        writeFileSync(join(broken, ".local", "leak-identifiers.json"), `{"k": [${name}]}`);
        const result = spawnSync(process.execPath, ["tools/osd-leak-scan.mjs", broken, "--print-masks"], {encoding: "utf8"});
        assert.equal(result.status, 1);
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(name));
      } finally {
        rmSync(broken, {recursive: true, force: true});
      }
    });

    for (const [label, list] of [
      ["a line break in a name", {k: [`${name}\nmore`]}],
      ["a line break in a category", {[`k\n${name}`]: ["abcdef"]}],
      ["a string where an array belongs", {k: name}],
      ["a name that is not a string", {k: [42]}],
      ["a name too short to scan", {k: ["ab"]}],
      ["a category without names", {k: []}],
    ]) {
      it(`refuses a list with ${label}, without printing it`, () => {
        const broken = mkdtempSync(join(tmpdir(), "osd-leak-shape-"));
        try {
          mkdirSync(join(broken, ".local"), {recursive: true});
          writeFileSync(join(broken, ".local", "leak-identifiers.json"), JSON.stringify(list));
          const result = spawnSync(process.execPath, ["tools/osd-leak-scan.mjs", broken, "--print-masks"], {encoding: "utf8"});
          assert.equal(result.status, 1);
          assert.doesNotMatch(result.stdout + result.stderr, new RegExp(name));
          assert.doesNotMatch(result.stdout, /add-mask/);
        } finally {
          rmSync(broken, {recursive: true, force: true});
        }
      });
    }

    it("emits a mask for every name and category", () => {
      const result = run("--print-masks");
      assert.equal(result.status, 0);
      assert.deepEqual(result.stdout.trim().split("\n").sort(),
        [`::add-mask::${category}`, `::add-mask::${name}`].sort());
    });
  });
});
