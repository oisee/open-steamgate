// Preloaded in generator children. One JSON line per source read, before a
// generator can transform or copy the bytes into gen/.
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {dirname, relative, resolve, sep} from "node:path";
import {readEntry} from "./osd-read-record.mjs";

const log = process.env.OSD_GENERATOR_READS;
if (log) {
  const root = resolve(process.env.OSD_ROOT ?? process.cwd());
  const external = JSON.parse(process.env.OSD_READ_EXTERNAL ?? "[]").map(resolve);
  const ignored = JSON.parse(process.env.OSD_READ_EXCLUDE_PREFIXES ?? "[]").map(resolve);
  const original = fs.readFileSync;
  let recording = false;
  const under = (base, path) => { const rel = relative(base, path); return rel !== ".." && !rel.startsWith(`..${sep}`); };
  fs.readFileSync = (file, ...args) => {
    const value = original(file, ...args);
    if (recording || typeof file !== "string") return value;
    const actual = globalThis[Symbol.for("osd.generator.readPath")]?.(file) ?? file;
    const path = resolve(actual);
    const projected = path !== resolve(file);
    const rel = relative(root, path).split(sep).join("/");
    if ((!under(root, path) && !external.some(base => under(base, path))) || ignored.some(base => under(base, path))
        || !projected && /^(gen|build|output|tools|scripts|test|node_modules|\.git|\.local\/ci-artifact)(\/|$)/.test(rel)) return value;
    recording = true;
    try {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, typeof args[0] === "string" ? args[0] : args[0]?.encoding ?? "utf8");
      fs.appendFileSync(log, `${JSON.stringify(readEntry(root, path, bytes))}\n`);
    } finally { recording = false; }
    return value;
  };
  syncBuiltinESMExports();
}
