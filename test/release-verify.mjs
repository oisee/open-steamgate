// scripts/release-verify.mjs reads an artefact's header, not its name: a
// binary for another target, or one whose sidecar digest is not its own, is
// refused before a release uploads it. The serve and pages checks run in the
// release and preview workflows against the real artefacts.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {checkBinary, checkReleaseBinary, executableOf} from "../scripts/release-verify.mjs";
import {verifyPublicArtefact, writeArtefactProvenance} from "../tools/osd-provenance.mjs";
import {stageVscodeWeb} from "../scripts/stage-vscode-web.mjs";

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

  it("refuses to release a binary built from a private live generation, OSGo included", () => {
    const source = join(dir, "private-source");
    mkdirSync(join(source, "build/by-input/fixture"), {recursive: true});
    const generation = (record) => writeFileSync(join(source, "build/by-input/fixture/manifest.json"), JSON.stringify(record));
    symlinkSync("by-input/fixture", join(source, "build/live"));
    const binary = write("osgo-private", elf(0x3e));
    writeArtefactProvenance(binary, {generation: "old-private", systemDigest: null, systemPrivate: true, inputs: [{kind: "input", private: true}]});
    generation({systemDigest: null, systemPrivate: true});
    expect(() => checkReleaseBinary(binary, "go-linux-amd64", source)).to.throw().with.property("code", "PRIVATE_LAYER");
    generation({systemDigest: null});
    expect(() => checkReleaseBinary(binary, "go-linux-amd64", source)).to.throw(/no matching public system identity/);
    generation({systemDigest: null, systemPrivate: false, provenance: []});
    expect(() => checkReleaseBinary(binary, "go-linux-amd64", source)).to.throw().with.property("code", "PRIVATE_LAYER");
    writeArtefactProvenance(binary, {generation: "public", systemDigest: null, systemPrivate: false, inputs: []});
    expect(checkReleaseBinary(binary, "go-linux-amd64", source).target).to.equal("go-linux-amd64");
    // the CLI the release workflow runs: test/osd-layer.mjs, "public entry points"
  });

  it("checks Go release formats by the bytes they contain", () => {
    expect(checkBinary(write("osgo-linux-x64", elf(0x3e)), "go-linux-amd64").bytes).to.equal(64);
    expect(checkBinary(write("osgo-linux-arm64", elf(0xb7)), "go-linux-arm64").target).to.equal("go-linux-arm64");
    expect(checkBinary(write("osgo-darwin-arm64", macho(0x0100000c)), "go-darwin-arm64").sha256).to.have.length(64);
    expect(checkBinary(write("osgo-windows-x64.exe", pe(0x8664)), "go-windows-amd64").bytes).to.equal(256);
    expect(checkBinary(write("osgo-darwin-x64", macho(0x01000007)), "go-darwin-amd64").target).to.equal("go-darwin-amd64");
    expect(checkBinary(write("osgo-windows-arm64.exe", pe(0xaa64)), "go-windows-arm64").target).to.equal("go-windows-arm64");
  });

  it("binds public provenance to exact file and directory bytes", () => {
    const source = {generation: "synthetic-public", systemDigest: null, systemPrivate: false, inputs: [{kind: "lib", private: false}]};
    const binary = join(dir, "provenance-binary");
    writeFileSync(binary, "public");
    expect(() => verifyPublicArtefact(binary)).to.throw().with.property("code", "BAD_PROVENANCE");
    writeArtefactProvenance(binary, source);
    expect(verifyPublicArtefact(binary).generation).to.equal("synthetic-public");
    writeFileSync(binary, "changed");
    expect(() => verifyPublicArtefact(binary)).to.throw().with.property("code", "BAD_PROVENANCE");
    unlinkSync(`${binary}.osd-provenance.json`);
    const preview = join(dir, "provenance-preview");
    mkdirSync(preview);
    writeFileSync(join(preview, "index.html"), "public");
    writeArtefactProvenance(preview, source);
    expect(verifyPublicArtefact(preview).files).to.have.property("index.html");
    writeFileSync(join(preview, "extra.txt"), "private bytes");
    expect(() => verifyPublicArtefact(preview)).to.throw().with.property("code", "BAD_PROVENANCE");
  });

  it("refuses to stage an unproven VS Code web bundle", async () => {
    const extension = join(dir, "extension");
    mkdirSync(join(extension, "dist/web"), {recursive: true});
    writeFileSync(join(extension, "dist/web/extension.js"), "synthetic bundle");
    let error;
    try { await stageVscodeWeb(extension, join(dir, "staged-extension")); } catch (caught) { error = caught; }
    expect(error?.code).to.equal("BAD_PROVENANCE");
  });

  it("stages a public VS Code web bundle with byte-bound provenance", async () => {
    const extension = join(dir, "public-extension");
    for (const part of ["dist/web", "resources", "walkthrough", "media"]) mkdirSync(join(extension, part), {recursive: true});
    writeFileSync(join(extension, "dist/web/extension.js"), "synthetic public bundle");
    for (const file of ["README.md", "CHANGELOG.md"]) writeFileSync(join(extension, file), "synthetic\n");
    writeFileSync(join(extension, "package.json"), JSON.stringify({name: "synthetic", version: "1.0.0", main: "desktop.js", browser: "dist/web/extension.js"}));
    const publicSource = {generation: "synthetic-public-web", systemDigest: null, systemPrivate: false, inputs: []};
    writeArtefactProvenance(join(extension, "dist/web"), publicSource);
    const preview = join(dir, "public-preview");
    mkdirSync(preview);
    writeFileSync(join(preview, "index.html"), "synthetic preview");
    writeArtefactProvenance(preview, publicSource);
    const out = join(preview, "vscode-web");
    await stageVscodeWeb(extension, out);
    expect(verifyPublicArtefact(out).generation).to.equal("synthetic-public-web");
    expect(verifyPublicArtefact(preview).files).to.have.property("vscode-web/dist/web/extension.js");
  });

  it("archives only the public live CI generation", async () => {
    const root = join(dir, "ci-tree");
    for (const path of ["build/by-input/1234567890abcdef/output", "build/tmp", "build/source-by-digest", "build/xref", "gen", "packs", ".local/lars", ".local/ci-artifact/transpiler"])
      mkdirSync(join(root, path), {recursive: true});
    const {genHash} = await import("../tools/osd-build.mjs");
    writeFileSync(join(root, "build/by-input/1234567890abcdef/manifest.json"), JSON.stringify({hash: "1234567890abcdef",
      systemDigest: null, systemPrivate: false, provenance: [], gen: genHash(root)}));
    writeFileSync(join(root, "build/by-input/1234567890abcdef/output/init.mjs"), "public");
    writeFileSync(join(root, "build/tmp/private.bin"), "private");
    writeFileSync(join(root, "build/source-by-digest/private.bin"), "private");
    writeFileSync(join(root, "build/xref/private.bin"), "private");
    symlinkSync("by-input/1234567890abcdef", join(root, "build/live"));
    symlinkSync("build/live/output", join(root, "output"));
    const archive = join(dir, "ci-tree.tar");
    execFileSync(process.execPath, [resolve("tools/osd-ci-artifact.mjs"), "pack", archive], {cwd: root});
    const members = execFileSync("tar", ["-tf", archive], {encoding: "utf8"});
    expect(members).to.include("build/by-input/1234567890abcdef/output/init.mjs");
    expect(members).not.to.include("private.bin");
    expect(verifyPublicArtefact(archive).generation).to.equal("1234567890abcdef");
    const consumer = join(dir, "ci-consumer");
    mkdirSync(consumer);
    execFileSync("tar", ["-xf", archive, "-C", consumer]);
    expect(readFileSync(join(consumer, "output/init.mjs"), "utf8")).to.equal("public");
    expect(readFileSync(join(consumer, "build/live/manifest.json"), "utf8")).to.include("1234567890abcdef");
  });

  it("refuses a binary for another target, a script, and a sidecar that is not its digest", () => {
    expect(() => checkBinary(write("a", elf(0x3e)), "bun-linux-arm64")).to.throw(/not the elf machine 0xb7/);
    expect(() => checkBinary(write("b", Buffer.from("#!/bin/sh\n")), "bun-linux-x64-baseline")).to.throw(/is unknown/);
    expect(() => checkBinary(write("c", elf(0x3e), "0".repeat(64)), "bun-linux-x64-baseline")).to.throw(/\.sha256 says/);
    expect(() => checkBinary(write("d", elf(0x3e)), "bun-freebsd")).to.throw(/unknown release target/);
  });
});
