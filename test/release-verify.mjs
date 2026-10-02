// scripts/release-verify.mjs reads an artefact's header, not its name: a
// binary for another target, or one whose sidecar digest is not its own, is
// refused before a release uploads it. The serve and pages checks run in the
// release and preview workflows against the real artefacts.
import {expect} from "chai";
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkBinary, executableOf} from "../scripts/release-verify.mjs";

const elf = (machine) => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2; b[5] = 1; // 64-bit, little endian
  b.writeUInt16LE(machine, 18);
  return b;
};
const macho = (cpu) => {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cpu, 4);
  return b;
};
const pe = (machine) => {
  const b = Buffer.alloc(256);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  b.writeUInt16LE(machine, 0x84);
  return b;
};

describe("scripts/release-verify: an artefact by its content", () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), "osd-release-verify-")); });
  after(() => rmSync(dir, {recursive: true, force: true}));

  const write = (name, bytes, digest) => {
    const file = join(dir, name);
    writeFileSync(file, bytes);
    writeFileSync(`${file}.sha256`, `${digest ?? createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
    return file;
  };

  it("reads the format and machine of each release target's header", () => {
    expect(executableOf(elf(0x3e))).to.deep.equal({format: "elf", machine: 0x3e});
    expect(executableOf(elf(0xb7))).to.deep.equal({format: "elf", machine: 0xb7});
    expect(executableOf(macho(0x0100000c))).to.deep.equal({format: "macho", machine: 0x0100000c});
    expect(executableOf(pe(0x8664))).to.deep.equal({format: "pe", machine: 0x8664});
    expect(executableOf(macho(0x01000007))).to.deep.equal({format: "macho", machine: 0x01000007});
    expect(executableOf(pe(0xaa64))).to.deep.equal({format: "pe", machine: 0xaa64});
    expect(executableOf(Buffer.from("#!/bin/sh\n")).format).to.equal("unknown");
  });

  it("accepts a binary built for its target, with its own digest beside it", () => {
    expect(checkBinary(write("osd-linux-x64", elf(0x3e)), "bun-linux-x64-baseline").target).to.equal("bun-linux-x64-baseline");
    expect(checkBinary(write("osd-darwin-arm64", macho(0x0100000c)), "bun-darwin-arm64").bytes).to.equal(32);
    expect(checkBinary(write("osd-windows-x64.exe", pe(0x8664)), "bun-windows-x64-baseline").sha256).to.have.length(64);
    expect(checkBinary(write("osd-darwin-x64", macho(0x01000007)), "bun-darwin-x64-baseline").target).to.equal("bun-darwin-x64-baseline");
    expect(checkBinary(write("osd-windows-arm64.exe", pe(0xaa64)), "bun-windows-arm64").target).to.equal("bun-windows-arm64");
  });

  it("tells the two architectures of one format apart", () => {
    expect(() => checkBinary(write("e", macho(0x0100000c)), "bun-darwin-x64-baseline")).to.throw(/not the macho machine 0x1000007/);
    expect(() => checkBinary(write("f", pe(0x8664)), "bun-windows-arm64")).to.throw(/not the pe machine 0xaa64/);
    expect(() => checkBinary(write("g", macho(0x01000007)), "go-darwin-arm64")).to.throw(/not the macho machine 0x100000c/);
    expect(() => checkBinary(write("h", pe(0xaa64)), "go-windows-amd64")).to.throw(/not the pe machine 0x8664/);
  });

  it("checks Go release formats by the bytes they contain", () => {
    expect(checkBinary(write("osgo-linux-x64", elf(0x3e)), "go-linux-amd64").bytes).to.equal(64);
    expect(checkBinary(write("osgo-linux-arm64", elf(0xb7)), "go-linux-arm64").target).to.equal("go-linux-arm64");
    expect(checkBinary(write("osgo-darwin-arm64", macho(0x0100000c)), "go-darwin-arm64").sha256).to.have.length(64);
    expect(checkBinary(write("osgo-windows-x64.exe", pe(0x8664)), "go-windows-amd64").bytes).to.equal(256);
    expect(checkBinary(write("osgo-darwin-x64", macho(0x01000007)), "go-darwin-amd64").target).to.equal("go-darwin-amd64");
    expect(checkBinary(write("osgo-windows-arm64.exe", pe(0xaa64)), "go-windows-arm64").target).to.equal("go-windows-arm64");
  });

  it("refuses a binary for another target, a script, and a sidecar that is not its digest", () => {
    expect(() => checkBinary(write("a", elf(0x3e)), "bun-linux-arm64")).to.throw(/not the elf machine 0xb7/);
    expect(() => checkBinary(write("b", Buffer.from("#!/bin/sh\n")), "bun-linux-x64-baseline")).to.throw(/is unknown/);
    expect(() => checkBinary(write("c", elf(0x3e), "0".repeat(64)), "bun-linux-x64-baseline")).to.throw(/\.sha256 says/);
    expect(() => checkBinary(write("d", elf(0x3e)), "bun-freebsd")).to.throw(/unknown release target/);
  });
});
