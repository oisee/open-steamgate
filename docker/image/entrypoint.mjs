import {existsSync, mkdirSync} from "node:fs";
import {spawn, execFileSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

const env = process.env;
if (!/^\d{2}$/.test(env.INSTANCE ?? "00")) throw new Error("INSTANCE must be two digits, e.g. 06");
env.STG_DB ??= "file";
if (!["file", "duckdb", "hana", "postgres"].includes(env.STG_DB)) throw new Error("STG_DB must be file, duckdb, hana or postgres");
if (env.STG_DB === "duckdb" && Number(env.OSD_WORKERS ?? 1) !== 1) throw new Error("DuckDB requires OSD_WORKERS=1");
if (env.STG_DB === "hana") {
  for (const key of ["HANA_HOST", "HANA_PORT", "HANA_USER", "HANA_SCHEMA"]) {
    if (!env[key]) throw new Error(`${key} is required for HANA`);
  }
  if (!env.HANA_PASSWORD && !env.OSD_HANA_PASSWORD_FILE) throw new Error("Set HANA_PASSWORD or OSD_HANA_PASSWORD_FILE");
  if (!/^[A-Z][A-Z0-9_]{0,126}$/.test(env.HANA_SCHEMA)) throw new Error("HANA_SCHEMA must be an uppercase SQL identifier");
  if (env.STG_DB_FRESH === "1") throw new Error("Destructive STG_DB_FRESH is disabled in this container entrypoint");
} else if (env.STG_DB === "postgres") {
  for (const key of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"]) {
    if (!env[key]) throw new Error(`${key} is required for PostgreSQL`);
  }
  if (env.STG_DB_FRESH === "1") throw new Error("Destructive STG_DB_FRESH is disabled in this container entrypoint");
} else {
  env.STG_DB_PATH ??= `/data/osd.${env.STG_DB === "duckdb" ? "duckdb" : "sqlite"}`;
}
if (env.STG_TLS !== "0") {
  const dir = ".local/tls";
  mkdirSync(dir, {recursive: true});
  const key = `${dir}/osd.key`, cert = `${dir}/osd.crt`;
  if (existsSync(key) !== existsSync(cert)) throw new Error("TLS volume must contain both osd.key and osd.crt, or neither");
  if (!existsSync(cert)) {
    const san = env.TLS_SAN ?? "DNS:osd,DNS:localhost,IP:127.0.0.1";
    if (/[\r\n]/.test(san)) throw new Error("TLS_SAN must be one line");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
      "-keyout", key, "-out", cert, "-subj", "/CN=osd/O=open-steamgate", "-addext", `subjectAltName=${san}`], {stdio: "pipe"});
  }
}
const osd = spawn(process.execPath, ["test/run.mjs"], {stdio: "inherit", env});
const protocols = [];
let stopping = false;
const stop = signal => {
  if (stopping) return;
  stopping = true;
  for (const child of protocols) child.kill(signal);
  osd.kill(signal);
};
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop(signal));
osd.on("error", error => { console.error(error.message); process.exitCode = 1; stop("SIGTERM"); });
osd.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
  if (!stopping) stop("SIGTERM");
});
if (env.STG_PROTOCOLS !== "0") {
  let ready = false;
  for (let attempt = 0; attempt < 300 && !stopping; attempt++) {
    if (osd.exitCode !== null || osd.signalCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:3030/sap/bc/adt/core/http/build", {signal: AbortSignal.timeout(3000)});
      if (response.ok && (await response.json()).system?.serving) { ready = true; break; }
    } catch { /* startup still in progress */ }
    await delay(2000);
  }
  if (!ready && !stopping) {
    console.error("OSD did not become ready for DIAG/RFC within 10 minutes");
    process.exitCode = 1;
    stop("SIGTERM");
  }
  if (ready && !stopping) {
    for (const script of ["tools/protocols/diag-server.mjs", "tools/protocols/rfc-server.mjs"]) {
      const child = spawn(process.execPath, [script], {stdio: "inherit", env});
      protocols.push(child);
      child.on("error", error => { console.error(error.message); process.exitCode = 1; stop("SIGTERM"); });
      child.on("exit", (code, signal) => {
      if (!stopping) {
        console.error(`${script} exited (${signal ?? code})`);
        process.exitCode = code || 1;
        stop("SIGTERM");
      }
      });
    }
  }
}
