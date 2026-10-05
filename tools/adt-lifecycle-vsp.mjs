import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

export async function vspClient(url) {
  // Empty cwd prevents VSP from finding a workstation connection/config.
  const cwd = mkdtempSync(join(tmpdir(), "osd-lifecycle-vsp-"));
  const child = spawn(process.env.VSP ?? "vsp", ["--url", url, "--user", "OSD", "--password", "any", "--client", "001", "--mode", "focused"], {cwd, stdio:["pipe", "pipe", "pipe"]});
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
  child.on("error", fail);
  child.on("exit", () => { exited = true; fail(Error("VSP exited")); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 120000);
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
