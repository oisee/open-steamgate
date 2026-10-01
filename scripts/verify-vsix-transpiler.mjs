// Check the code inside the shipped seed, after both archive layers are opened.
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {readFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {Readable} from "node:stream";
import {createBrotliDecompress} from "node:zlib";
import {readLock} from "../tools/osd-lock.mjs";

const {unpackTar} = createRequire(import.meta.url)("../editors/vscode/launcher.js");

function requireContent(root, path, pattern) {
  const content = readFileSync(join(root, path), "utf8");
  if (!pattern.test(content)) throw new Error(`VSIX seed lacks ${pattern} in ${path}`);
}

export async function verifyVsixTranspiler(file) {
  const archive = resolve(file);
  const compressed = execFileSync("unzip", ["-p", archive, "extension/osd/seed.tar.br"], {maxBuffer: 64 * 1024 * 1024});
  const scratch = mkdtempSync(join(tmpdir(), "osd-vsix-transpiler-"));
  try {
    await unpackTar(Readable.from([compressed]).pipe(createBrotliDecompress()), scratch);
    const expected = readLock(resolve(".")).transpiler.ref;
    const actual = readFileSync(join(scratch, ".osd-transpiler-ref"), "utf8").trim();
    if (actual !== expected) throw new Error(`VSIX transpiler ref ${actual} differs from libs.lock.json ${expected}`);
    requireContent(scratch, "node_modules/@abaplint/transpiler/build/src/types.d.ts", /only\?:\s*\(obj:/);
    requireContent(scratch, "node_modules/@abaplint/transpiler/build/src/index.js", /this\.options\?\.only\?\.\(obj\) === false/);
    requireContent(scratch, "node_modules/@abaplint/transpiler/build/src/validation.js", /reg\.getConfig\(\)\.get\(\)\) === JSON\.stringify\(conf\.get\(\)\)/);
    requireContent(scratch, "node_modules/@abaplint/transpiler/build/src/validation.js", /obj\.setDirty\(\)/);
    requireContent(scratch, "node_modules/@abaplint/runtime/build/src/context.js", /dataset\s*=\s*undefined/);
    requireContent(scratch, "node_modules/@abaplint/runtime/build/src/statements/dataset.js", /this\.context\.dataset/);
    console.log(`VSIX transpiler: ${actual}; only option and DATASET host found in bundled code`);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1]?.endsWith("verify-vsix-transpiler.mjs")) {
  if (process.argv.length !== 3) {
    console.error("usage: node scripts/verify-vsix-transpiler.mjs <file.vsix>");
    process.exitCode = 2;
  } else {
    verifyVsixTranspiler(process.argv[2]).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
