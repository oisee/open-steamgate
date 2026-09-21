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
});
