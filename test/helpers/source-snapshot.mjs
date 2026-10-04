// Byte-route fixtures need a declared active generation even when their
// deliberately odd source cannot be transpiled.
import {createHash} from "node:crypto";
import {existsSync, readFileSync, readdirSync, rmSync, symlinkSync} from "node:fs";
import {join} from "node:path";
import {keepSourceInputs, completeSourceSnapshot} from "../../tools/osd-source-snapshot.mjs";

export function activeFixture(root, folders = ["src"]) {
  const digests = new Map();
  const walk = dir => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) digests.set(file, createHash("sha256").update(readFileSync(file)).digest("hex"));
    }
  };
  for (const folder of folders) walk(join(root, folder));
  const hash = "fixture-" + createHash("sha256").update(JSON.stringify([...digests])).digest("hex").slice(0, 16);
  const generation = join(root, "build", "by-input", hash);
  if (!existsSync(join(generation, "source", ".complete"))) {
    keepSourceInputs(root, generation, digests);
    completeSourceSnapshot(generation);
  }
  rmSync(join(root, "build", "live"), {force: true});
  symlinkSync(join("by-input", hash), join(root, "build", "live"));
}
