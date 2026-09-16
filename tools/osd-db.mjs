// The databases: which files exist, what DDIC each was made for, and a fork
// of any of them. The second coordinate of an instance (docs/generations.md).
//
//   node tools/osd-db.mjs list                      every file under .local/db, with its stamp
//   node tools/osd-db.mjs fork <from> <to>          a consistent copy, taken while <from> is open
//   node tools/osd-db.mjs base                      the base images, one per schema
import {existsSync, readdirSync, statSync} from "node:fs";
import {join, relative} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BASE_DIR, forkDatabase} from "./sqlite-file-client.mjs";

const DB_DIR = ".local/db";

function stampOf(file) {
  try {
    const db = new DatabaseSync(file, {readOnly: true});
    try {
      return db.prepare("SELECT fingerprint, at FROM osd_schema LIMIT 1").get();
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function files(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((n) => n.endsWith(".sqlite")).map((n) => {
    const file = join(dir, n);
    const stamp = stampOf(file);
    return {file, bytes: statSync(file).size, schema: stamp?.fingerprint, stampedAt: stamp?.at};
  });
}

export function list(root = process.cwd()) {
  return {databases: files(join(root, DB_DIR)), base: files(join(root, BASE_DIR))};
}

function main(args) {
  const cmd = args[0] ?? "list";
  const say = (m) => console.log(`osd-db: ${m}`);
  if (cmd === "fork") {
    const [, from, to] = args;
    if (!from || !to) {
      say("fork <from> <to>");
      return 2;
    }
    forkDatabase(from, to);
    say(`${to} <- ${from} (${statSync(to).size} bytes, committed rows only)`);
    return 0;
  }
  const {databases, base} = list();
  const rows = cmd === "base" ? base : [...databases, ...base];
  if (rows.length === 0) {
    say("no databases yet");
  }
  for (const r of rows) {
    say(`${relative(process.cwd(), r.file).padEnd(44)} ${String(r.bytes).padStart(10)} bytes  schema ${r.schema ?? "unstamped"}${r.stampedAt ? "  " + r.stampedAt : ""}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  process.exit(main(process.argv.slice(2)));
}
