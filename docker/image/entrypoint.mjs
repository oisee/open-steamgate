import {existsSync, mkdirSync} from "node:fs";
import {spawn, execFileSync} from "node:child_process";

const env = process.env;
if (!/^\d{2}$/.test(env.INSTANCE ?? "00")) throw new Error("INSTANCE must be two digits, e.g. 06");
env.STG_DB ??= "file";
if (!["file", "duckdb", "hana"].includes(env.STG_DB)) throw new Error("STG_DB must be file, duckdb or hana");
if (env.STG_DB === "duckdb" && Number(env.OSD_WORKERS ?? 1) !== 1) throw new Error("DuckDB requires OSD_WORKERS=1");
if (env.STG_DB === "hana") {
  for (const key of ["HANA_HOST", "HANA_PORT", "HANA_USER", "HANA_SCHEMA"]) {
    if (!env[key]) throw new Error(`${key} is required for HANA`);
  }
  if (!env.HANA_PASSWORD && !env.OSD_HANA_PASSWORD_FILE) throw new Error("Set HANA_PASSWORD or OSD_HANA_PASSWORD_FILE");
  if (!/^[A-Z][A-Z0-9_]{0,126}$/.test(env.HANA_SCHEMA)) throw new Error("HANA_SCHEMA must be an uppercase SQL identifier");
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
const child = spawn(process.execPath, ["test/run.mjs"], {stdio: "inherit", env});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
