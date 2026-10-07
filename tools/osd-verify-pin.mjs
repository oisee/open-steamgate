// Cross-process GC protection for a generation and the verifier's scratch.
import {randomUUID} from "node:crypto";
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {layout, lock} from "./osd-build.mjs";
import {MissingCompileInputs} from "./osd-compile-snapshot.mjs";

export async function verificationLock(root, deadlineMs = 30000) {
  const paths = layout(root), until = Date.now() + deadlineMs;
  let unlock;
  for (;;) {
    try { unlock = lock(paths); break; } catch (error) {
      if (error.code !== "BUSY") throw error;
      if (Date.now() >= until) throw Object.assign(new Error("verification build lock deadline exceeded"), {code: "VERIFY_TIMEOUT"});
      await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(1, until - Date.now()))));
    }
  }
  return unlock;
}

export async function pinVerification(root, hash, scratch, options = {}) {
  const paths = layout(root), unlock = await verificationLock(root, options.deadlineMs);
  try {
    if (!existsSync(join(paths.byInput, hash, "manifest.json"))) {
      throw new MissingCompileInputs(`missing generation under verification: ${hash}`);
    }
    const dir = join(paths.build, "verify-pins");
    mkdirSync(dir, {recursive: true});
    const file = join(dir, `${process.pid}.${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({pid: process.pid, hash, scratch, createdAt: Date.now()}));
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
    // A lease also bounds PID reuse and legacy pins without a timestamp.
    if (!Number.isFinite(pin.createdAt) || Date.now() - pin.createdAt > 300000 || pin.createdAt > Date.now()) {
      rmSync(path, {force: true});
      continue;
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
