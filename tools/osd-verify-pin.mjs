// Cross-process GC protection for a generation and the verifier's scratch.
import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {layout, lock} from "./osd-build.mjs";
import {MissingCompileInputs} from "./osd-compile-snapshot.mjs";

export async function pinVerification(root, hash, scratch) {
  const paths = layout(root);
  let unlock;
  for (;;) {
    try { unlock = lock(paths); break; } catch (error) {
      if (error.code !== "BUSY") throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try {
    if (!existsSync(join(paths.byInput, hash, "manifest.json"))) {
      throw new MissingCompileInputs(`missing generation under verification: ${hash}`);
    }
    const dir = join(paths.build, "verify-pins");
    mkdirSync(dir, {recursive: true});
    const file = join(dir, `${process.pid}.${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({pid: process.pid, hash, scratch}));
    return () => rmSync(file, {force: true});
  } finally { unlock(); }
}

// Called under the build lock. Reap pins left by terminated verifiers.
export function verificationPins(root) {
  const dir = join(layout(root).build, "verify-pins"), pins = [];
  if (!existsSync(dir)) return pins;
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    let pin;
    try { pin = JSON.parse(readFileSync(path, "utf8")); } catch (error) {
      if (error.code === "ENOENT") continue; // A finished verifier released it.
      throw error;
    }
    try { process.kill(pin.pid, 0); } catch (error) {
      if (error.code !== "ESRCH") throw error;
      rmSync(path, {force: true});
      continue;
    }
    pins.push(pin);
  }
  return pins;
}
