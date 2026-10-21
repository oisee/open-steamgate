// The misses of a replay, for the person who has to fill them.
//
// tools/osd-http-replay.mjs keeps every request no fixture answered, with
// the nearest recording at the same path and how it differs. This serves
// them (`/sap/bc/osd/replay/misses`, mounted by tools/osd-remote-service.mjs)
// and makes one a fixture (`promote`, the CLI tools/osd-replay-promote.mjs
// and `osd replay-promote`). The page only reads: writing a fixture is a
// person's decision, because a recording carries a system's data and where
// it lands decides whether it is published.
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {isAbsolute, join, relative, resolve} from "node:path";
import {ODATA_ROOT, pathKey, replayer, replayKey, splitUrl} from "./osd-http-replay.mjs";

/** the URL a miss was asked at, from the root, as a page sent it */
const missUrl = ({service, path, query}) => `${ODATA_ROOT}${service}${path === "" ? "" : `/${path}`}${query === "" ? "" : `?${query}`}`;

/** the command that turns a miss into a fixture from its nearest
 *  recording, for the host this runs on: `osd replay-promote` from a binary
 *  (OSD_SELF, tools/osd-host.mjs), the tool from a checkout; quoted for
 *  cmd.exe on Windows, where a single quote is not a quote */
export function promoteCommand(miss, {env = process.env, platform = process.platform} = {}) {
  const quote = (text) => (platform === "win32" ? `"${text.replaceAll('"', '""')}"` : `'${text.replaceAll("'", "'\\''")}'`);
  const self = env.OSD_SELF === undefined || env.OSD_SELF === "" ? undefined : JSON.parse(env.OSD_SELF);
  const word = (w) => (w.includes(" ") ? quote(w) : w);
  const command = self === undefined ? "node tools/osd-replay-promote.mjs" : [...self.map(word), "replay-promote"].join(" ");
  return `${command} --destination ${miss.destination} --url ${quote(missUrl(miss.request))} --out .local/replay/promoted`;
}

const escapeHtml = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** `/sap/bc/osd/replay/misses`: every miss of every replaying destination of
 *  this run, newest last -- JSON, or a table with `?format=html` or a
 *  browser's Accept. Each carries the nearest recording, the batch parts it
 *  was asked in and the command that promotes it. Read only: writing a
 *  fixture is the CLI's, run by a person, because a recording carries a
 *  system's data and where it lands is a decision. */
export function missesHandler(replayers) {
  return (req, res) => {
    const misses = [...replayers].flatMap((r) => r.misses()).map((m) => ({...m, promote: promoteCommand(m)}));
    const html = req.query?.format === "html" || (req.query?.format === undefined && String(req.headers.accept ?? "").includes("text/html"));
    if (!html) {
      res.json({misses});
      return;
    }
    const rows = misses.map((m) => `<tr><td>${escapeHtml(m.destination)}</td><td>${m.count}</td><td><code>${escapeHtml(m.key)}</code>` +
      `${m.parts.map((p) => `<br>batch part ${p.part}: <code>${escapeHtml(p.line)}</code>`).join("")}</td>` +
      `<td>${m.closest === undefined ? "nothing at this path" : `<code>${escapeHtml(m.closest.file ?? m.closest.key)}</code><br>` +
        m.closest.differences.map((d) => `${escapeHtml(d.option)}: asked <code>${escapeHtml(d.asked ?? "(none)")}</code>, recorded <code>${escapeHtml(d.recorded ?? "(none)")}</code>`).join("<br>")}</td>` +
      `<td><code>${escapeHtml(m.promote)}</code></td></tr>`).join("\n");
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Replay misses</title>
<style>body{font:14px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 6px;vertical-align:top;text-align:left}code{font-size:12px;word-break:break-all}</style>
<h1>Replay misses (${misses.length})</h1>
<table><tr><th>destination</th><th>count</th><th>request</th><th>closest recording</th><th>promote</th></tr>
${rows}</table>`);
  };
}

/** whether git would publish `path`: inside the work tree of `tree` and not
 *  ignored. Outside a work tree nothing is published. */
function trackable(path, tree) {
  let top;
  try {
    top = execFileSync("git", ["-C", tree, "rev-parse", "--show-toplevel"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return false;
  }
  const rel = relative(top, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false;
  }
  try {
    execFileSync("git", ["-C", top, "check-ignore", "-q", "--no-index", rel === "" ? "." : rel], {stdio: "ignore"});
    return false;
  } catch {
    return true;
  }
}

/** A miss made a fixture: the request's own key, the response of `from`
 *  (a fixture file) or, without one, of the nearest recording at the same
 *  path. Written into `out` only when git would not publish it there, and
 *  never over a file. Returns {file, from}. */
export function promote({fixtures, url, from, out, tree = process.cwd(), say = console.error}) {
  const request = splitUrl(url);
  if (request === undefined) {
    throw new Error(`not an OData URL: ${url}`);
  }
  const folder = resolve(out);
  if (trackable(folder, tree)) {
    throw new Error(`${out} is inside the tree and not ignored by git; a promoted fixture carries a system's data -- write it under .local/ or a private pack's ignored folder`);
  }
  let source;
  if (from !== undefined) {
    source = JSON.parse(readFileSync(from, "utf8"));
  } else {
    const replay = replayer(fixtures, {say: () => {}});
    const nearest = replay.nearest({method: "GET", ...request});
    if (nearest === undefined) {
      throw new Error(`nothing is recorded at ${pathKey({method: "GET", ...request})}; name a fixture with --from`);
    }
    source = fixtures.get(nearest.key);
    from = nearest.file ?? nearest.key;
    say(`osd-http-replay: promoting from ${from}: ${nearest.differences.map((d) => `${d.option} asked ${d.asked ?? "(none)"}, recorded ${d.recorded ?? "(none)"}`).join("; ") || "same query"}`);
  }
  const key = {method: "GET", service: request.service, path: request.path, query: request.query};
  const name = `promoted-${createHash("sha256").update(replayKey(key)).digest("hex").slice(0, 12)}.json`;
  const file = join(folder, name);
  if (existsSync(file)) {
    throw new Error(`${file} exists; a promoted fixture is never overwritten`);
  }
  mkdirSync(folder, {recursive: true});
  writeFileSync(file, `${JSON.stringify({key, response: source.response, promotedFrom: relative(folder, resolve(String(from)))}, null, 2)}\n`);
  return {file, from};
}
