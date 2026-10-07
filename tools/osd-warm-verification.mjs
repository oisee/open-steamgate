// Verification owns a bounded child lifetime and certifies one publication.
import {randomUUID} from "node:crypto";
import {readFileSync, writeFileSync, renameSync, rmSync, statSync, existsSync} from "node:fs";
import {join} from "node:path";
import {once} from "node:events";
import {layout} from "./osd-build.mjs";
import {warmVerdict} from "./osd-hot.mjs";
import {verificationLock} from "./osd-verify-pin.mjs";
import {spawn} from "./osd-child-process.mjs";
import {toolCommand} from "./osd-host.mjs";

export function generationIdentity(generation) {
  try {
    const stat = statSync(join(generation, "manifest.json"));
    let side, sideStat;
    try { sideStat = statSync(`${generation}.warm.json`); side = readFileSync(`${generation}.warm.json`, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return JSON.stringify([stat.dev, stat.ino, stat.birthtimeMs, sideStat?.dev, sideStat?.ino, side]);
  } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

// At most three recent hashes plus the running comparison; disk keeps history.
export const VERIFY_HISTORY_LIMIT = 3;
export function pruneVerification(compiler, retained) {
  const paths = layout(compiler.root);
  for (const hash of compiler.unverified) {
    const generation = join(paths.byInput, hash);
    if (hash === compiler.verifying?.osdHash) continue;
    if ((retained && !retained.has(hash)) || !existsSync(join(generation, "manifest.json")) || warmVerdict(generation) !== false) compiler.unverified.delete(hash);
  }
  const recent = [...compiler.unverified].filter(hash => hash !== compiler.verifying?.osdHash);
  for (const hash of recent.slice(0, -VERIFY_HISTORY_LIMIT)) {
    compiler.unverified.delete(hash);
  }
}

export async function waitVerifier(child, ms) {
  if (!child || child.exitCode !== null || child.signalCode != null) return;
  let timer;
  const exited = once(child, "exit").catch(() => undefined);
  try {
    await Promise.race([exited, new Promise(resolve => {
      timer = setTimeout(() => {
        child.osdCancelled = `verification wait exceeded ${ms} ms`;
        child.kill("SIGKILL");
        resolve();
      }, ms);
    })]);
    await exited;
  } finally { clearTimeout(timer); }
}

export async function settleVerification(compiler, hash, identity, result) {
  if (!["same", "differs"].includes(result.verdict)) return result;
  const generation = join(layout(compiler.root).byInput, hash), side = `${generation}.warm.json`;
  let unlock, tmp;
  try {
    unlock = await verificationLock(compiler.root, compiler.settleDeadlineMs);
    if (identity === undefined || generationIdentity(generation) !== identity) {
      return {verdict: "superseded", why: "generation or verification sidecar replaced"};
    }
    if (existsSync(side)) {
      const note = JSON.parse(readFileSync(side, "utf8"));
      tmp = `${side}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify({...note, ...(result.verdict === "same"
        ? {verified: true, verifiedAt: new Date().toISOString()}
        : {verified: false, differs: result.differing})}, null, 2));
      renameSync(tmp, side);
    }
    compiler.unverified.delete(hash);
    return result;
  } catch (error) {
    // A comparison already proved a mismatch. Settlement trouble must not
    // turn that evidence into a generic failure and bypass cold recovery.
    if (result.verdict === "differs") return {...result, settlementError: error.message};
    return {verdict: error.code === "ENOENT" ? "superseded" : "failed", why: error.message};
  } finally { if (tmp) rmSync(tmp, {force: true}); unlock?.(); }
}

export function startVerification(compiler, hash, script) {
  return new Promise(resolve => {
    const generation = join(layout(compiler.root).byInput, hash);
    const identity = generationIdentity(generation);
    const [cmd, ...args] = toolCommand(script, ["verify", hash]);
    const child = spawn(cmd, args, {cwd: compiler.root, stdio: ["ignore", "pipe", "pipe"],
      env: {...process.env, OSD_ROOT: compiler.root}});
    compiler.verifying = child;
    child.osdHash = hash;
    let out = "", settled = false;
    const finish = async result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { resolve(await settleVerification(compiler, hash, identity, result)); }
      catch (error) { resolve({verdict: "failed", why: error.message}); }
      finally {
        if (compiler.verifying === child) compiler.verifying = undefined;
        compiler.pruneVerification();
      }
    };
    const timer = setTimeout(() => {
      child.osdCancelled = "verification deadline exceeded";
      child.kill("SIGKILL");
    }, compiler.verifyDeadlineMs ?? 180000);
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { out += d; });
    child.on("error", error => finish({verdict: "failed", output: error.message}));
    child.on("close", code => {
      let result;
      try { result = child.osdCancelled ? {verdict: "cancelled", why: child.osdCancelled} : JSON.parse(out.trim().split("\n").pop()); }
      catch { result = {verdict: "failed", code, output: out.slice(-2000)}; }
      void finish(result);
    });
  });
}
