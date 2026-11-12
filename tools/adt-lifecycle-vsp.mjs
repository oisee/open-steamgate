import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {speed} from "./warm-deadline/warm-deadline.mjs";

// The params.timeout, in seconds, that a VSP WriteSource/Activate call gets
// when the operation needs no special margin.
export const CALL_TIMEOUT_S = 90;
// DDLS activation re-runs the CDS generator and a cold build inside one call:
// ~50 s per DDLS update on a green CI runner, ~90 s on a loaded box, against
// this 90 s budget -- CI #922/#908/#926 failed only here, every full rerun
// passed. The warm deadline answers the same shape by scaling its base with
// the measured-speed factor (tools/warm-deadline, docs/warm-compile.md), so
// the DDLS budget does the same: 90 s x factor, never below today's 90 s,
// never above 240 s -- about 4x the CI median, the room a loaded runner's
// activation needs.
export function ddlsCallTimeoutS(env = process.env) {
  return Math.min(240, Math.max(CALL_TIMEOUT_S, Math.round(CALL_TIMEOUT_S * speed(env).factor)));
}

export async function vspClient(url) {
  // Empty cwd and an empty home prevent VSP from finding a workstation
  // connection/config; a developer's ~/.vsp.json pins a real system and its
  // identity check refuses the OSD logon before any call is made.
  const cwd = mkdtempSync(join(tmpdir(), "osd-lifecycle-vsp-"));
  const child = spawn(process.env.VSP ?? "vsp", ["--url", url, "--user", "OSD", "--password", "any", "--client", "001", "--mode", "focused"], {cwd, env:{...process.env, HOME:cwd, USERPROFILE:cwd}, stdio:["pipe", "pipe", "pipe"]});
  const pending = new Map();
  let serial = 0, exited = false;
  const rl = createInterface({input:child.stdout});
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  rl.on("line", line => {
    let r; try { r = JSON.parse(line); } catch { return; }
    const p = pending.get(r.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(r.id);
    r.error ? p.reject(Error(r.error.message)) : p.resolve(r.result);
  });
  child.stderr.on("data", () => {});
  // A VSP that died mid-call must fail its pending rpc, not crash the
  // harness with an unhandled EPIPE before any report row exists.
  child.stdin.on("error", fail);
  child.on("error", fail);
  child.on("exit", () => { exited = true; fail(Error("VSP exited")); });
  // The ceiling only catches a dead or silent VSP; it must never be the
  // binding budget, so it rides above the widest params.timeout the lifecycle
  // sends (the DDLS budget) by a minute of readback slack. At the old 90 s
  // budgets this stays 120 s.
  const ceilingMs = Math.max(120000, (ddlsCallTimeoutS() + 60) * 1000);
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, ceilingMs);
    pending.set(id, {resolve, reject, timer});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0", id, method, params}) + "\n", error => { if (error) fail(error); });
  });
  const close = async () => {
    fail(Error("VSP closed"));
    if (!exited) await new Promise(resolve => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
    });
    rl.close(); rmSync(cwd, {recursive:true, force:true});
  };
  try {
    await rpc("initialize", {protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{name:"osd-lifecycle", version:"1"}});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0", method:"notifications/initialized"}) + "\n");
    return {close, tool:async (name, args) => {
      const r = await rpc("tools/call", {name, arguments:args});
      if (r.isError) throw Error(r.content?.map(b=>b.text ?? "").join("\n") ?? "VSP error");
      return r;
    }};
  } catch (error) { await close(); throw error; }
}
