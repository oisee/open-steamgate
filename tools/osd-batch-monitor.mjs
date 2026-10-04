// Opt-in, read-only operations door. The token is supplied by the instance
// owner; without it the route is absent rather than exposing saved output.
import {createHash, timingSafeEqual} from "node:crypto";
import {statSync} from "node:fs";
import {BatchRuns, operationsPath} from "./osd-batch-runs.mjs";
import {retainOperationsReader} from "./osd-operations-files.mjs";

const tokenHash = (value) => createHash("sha256").update(value).digest();

function authorized(req, res, env) {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  const secret = env.OSD_BATCH_READ_TOKEN;
  if (!secret) {
    res.status(404).json({error: {code: "NOT_FOUND"}});
    return false;
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    res.status(503).json({error: {code: "MONITOR_TOKEN_INVALID"}});
    return false;
  }
  const header = req.get("Authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(tokenHash(secret), tokenHash(supplied))) {
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).json({error: {code: "UNAUTHORIZED"}});
    return false;
  }
  return true;
}

// Keep the WAL open between requests: otherwise a retiring worker can be the
// last connection and checkpoint under an exclusive lock during handoff.
function monitorReader(root, env) {
  let store, fileId, releaseReader;
  const servers = new WeakSet();
  const close = () => { store?.close(); store = undefined; releaseReader?.(); releaseReader = undefined; };
  return {
    close,
    attachServer(server) {
      if (!servers.has(server)) { servers.add(server); server.once("close", close); }
      if (env.OSD_BATCH_READ_TOKEN) {
        const candidate = this.open({socket: {server}}); this.release(candidate);
      }
    },
    open(req) {
      let nextId;
      try { const file = statSync(operationsPath(root, env)); nextId = `${file.dev}:${file.ino}`; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (store && nextId !== fileId) close();
      if (!store) {
        const candidate = new BatchRuns(root, env, {readOnly: true});
        // An empty fallback must not hide a ledger created by a later worker.
        if (candidate.memoryOnly) return candidate;
        store = candidate; fileId = nextId;
        releaseReader = retainOperationsReader(store.path, close);
      }
      const server = req.socket?.server;
      if (server && !servers.has(server)) {
        servers.add(server); server.once("close", close);
      }
      return store;
    },
    release(candidate) { if (candidate !== store) candidate.close(); },
  };
// Add operator metadata without exposing source paths, runtime identities or selections.
function jobMetadata(store, run, detail = false) {
  const row = store.db.prepare("SELECT * FROM batch_runs WHERE id = ?").get(run.id);
  const metadata = {...run, user: row.source_owner ?? null,
    afterEvent: row.after_job_name ? {jobname: row.after_job_name, jobcount: row.after_job_count} : null,
    namedEvent: row.after_named_id ? {id: row.after_named_id, param: row.after_named_param} : null,
    schedule: row.sdl_at ? {start: row.sdl_at, last: row.last_at} : null};
  if (detail) metadata.log = store.db.prepare(`SELECT seq AS sequence, step_no AS step,
    occurred_at AS at, event_code AS event, severity, text FROM batch_job_log
    WHERE run_id = ? ORDER BY seq LIMIT 2000`).all(run.id);
  return metadata;
}

export function batchMonitorHandler(root, env = process.env) {
  const reader = monitorReader(root, env);
  return Object.assign(function (req, res) {
    if (!authorized(req, res, env)) return;
    const query = req.query;
    if (Object.keys(query).some((key) => !["id", "output", "limit"].includes(key))) {
      res.status(400).json({error: {code: "BAD_QUERY"}});
      return;
    }
    try {
      const store = reader.open(req);
      try {
        if (query.id !== undefined) {
          if (query.limit !== undefined || (query.output !== undefined && query.output !== "1")
              || typeof query.id !== "string" || !/^[0-9a-f-]{36}$/.test(query.id)) {
            res.status(400).json({error: {code: "BAD_QUERY"}});
            return;
          }
          const run = store.get(query.id);
          if (!run) {
            res.status(404).json({error: {code: "RUN_NOT_FOUND"}});
            return;
          }
          if (query.output === "1") {
            const output = store.output(query.id);
            if (!output) {
              res.status(404).json({error: {code: "OUTPUT_NOT_FOUND"}});
              return;
            }
            res.json({runId: query.id, output});
          } else {
            res.json({run: store.readSnapshot(() => jobMetadata(store, store.readRun(run.id), true))});
          }
          return;
        }
        if (query.output !== undefined || (query.limit !== undefined
            && (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))) {
          res.status(400).json({error: {code: "BAD_QUERY"}});
          return;
        }
        const limit = Number(query.limit ?? 50);
        if (limit > 200) {
          res.status(400).json({error: {code: "BAD_QUERY"}});
          return;
        }
        res.json({runs: store.readSnapshot(() => store.db.prepare(`SELECT id FROM batch_runs
          ORDER BY COALESCE(queued_at, started_at) DESC, id DESC LIMIT ?`).all(limit)
          .map(({id}) => jobMetadata(store, store.readRun(id))))});
      } finally {
        reader.release(store);
      }
    } catch (error) {
      res.status(500).json({error: {code: "MONITOR_FAILED", message: String(error.message ?? error)}});
    }
  }, {close: reader.close, attachServer: server => reader.attachServer(server)});
}

// The extension's private counts door shares authentication with the monitor.
export function batchCountsHandler(root, env = process.env) {
  const reader = monitorReader(root, env);
  return Object.assign(function (req, res) {
    const address = req.socket.remoteAddress ?? "";
    if (address !== "::1" && !/^127\./.test(address) && !/^::ffff:127\./.test(address)) {
      res.status(403).json({error: {code: "LOCAL_ONLY"}});
      return;
    }
    if (!authorized(req, res, env)) return;
    if (Object.keys(req.query).length !== 0) {
      res.status(400).json({error: {code: "BAD_QUERY"}});
      return;
    }
    try {
      const store = reader.open(req);
      try {
        const counts = store.readSnapshot(() => store.db.prepare(`SELECT
          COALESCE(SUM(state = 'RUNNING'), 0) AS running,
          COALESCE(SUM(state = 'QUEUED'), 0) AS queued FROM batch_runs`).get());
        res.json({counts});
      } finally { reader.release(store); }
    } catch (error) {
      res.status(500).json({error: {code: "MONITOR_FAILED", message: String(error.message ?? error)}});
    }
  }, {close: reader.close, attachServer: server => reader.attachServer(server)});
}
