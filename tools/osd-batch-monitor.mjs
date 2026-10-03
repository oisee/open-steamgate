// Opt-in, read-only operations door. The token is supplied by the instance
// owner; without it the route is absent rather than exposing saved output.
import {createHash, timingSafeEqual} from "node:crypto";
import {BatchRuns} from "./osd-batch-runs.mjs";

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

export function batchMonitorHandler(root, env = process.env) {
  return function (req, res) {
    if (!authorized(req, res, env)) return;
    const query = req.query;
    if (Object.keys(query).some((key) => !["id", "output", "limit", "counts"].includes(key))) {
      res.status(400).json({error: {code: "BAD_QUERY"}});
      return;
    }
    try {
      const store = new BatchRuns(root, env);
      try {
        if (query.counts !== undefined) {
          if (query.counts !== "1" || Object.keys(query).length !== 1) {
            res.status(400).json({error: {code: "BAD_QUERY"}});
            return;
          }
          const counts = store.readSnapshot(() => store.db.prepare(`SELECT
            COALESCE(SUM(state = 'RUNNING'), 0) AS running,
            COALESCE(SUM(state = 'QUEUED'), 0) AS queued FROM batch_runs`).get());
          res.json({counts});
          return;
        }
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
            res.json({run});
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
        res.json({runs: store.list(limit)});
      } finally {
        store.close();
      }
    } catch (error) {
      res.status(500).json({error: {code: "MONITOR_FAILED", message: String(error.message ?? error)}});
    }
  };
}
