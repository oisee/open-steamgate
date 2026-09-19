// The first real use of the lazy-against-forced instrument: run it on bodies
// that came out of the corpus, not on plans assembled by hand.
//
// Two halves, and the second is the one that makes the first mean anything:
//
//   the bodies    only those that need nothing but their own IN table
//                 parameters. A body that reads a table of somebody else's
//                 system needs a schema we would have to invent, and an
//                 invented schema answers an invented question.
//   the rows      asked of the plan (`adversarialRows`), not imagined. A
//                 cast diverges on the one row that is not a number, a
//                 division on the one where the divisor is zero. A fixture
//                 written to look like life contains none of them, so "no
//                 difference" would mean "the data never reached the place
//                 where there is one".
//
//   node tools/sqlscript/check-corpus.mjs [.local/a4h-export]
import {readFileSync, readdirSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename,join} from "node:path";
import {lex} from "./lexer.mjs";
import {parse} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {adversarialRows, schemaOf} from "../sqlscript-ir.mjs";
import {runBothWays, compare} from "../sqlscript-eager.mjs";
import * as extractor from "../amdp-extract.mjs";

const isTableParam = (p) => /^(it|et|ct)_/i.test(String(p?.name ?? ""));

/** every scan in a plan, so a body can be judged self-contained or not */
function scansOf(rel, found = []) {
  if (rel === null || typeof rel !== "object") return found;
  if (rel.rel === "scan") found.push(rel.table);
  for (const v of Object.values(rel)) scansOf(v, found);
  return found;
}

function classesIn(zip, dir) {
  mkdirSync(dir, {recursive: true});
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".clas.abap")) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out;
}

export function candidates(root = ".local/a4h-export", scratch = "/tmp/sqlscript-check") {
  const found = [];
  for (const zip of readdirSync(root).filter((f) => f.endsWith(".zip"))) {
    for (const file of classesIn(join(root, zip), join(scratch, zip.replace(/\.zip$/, "")))) {
      let cls;
      try {
        cls = extractor.extract(readFileSync(file, "utf8"), file.split("/").pop());
      } catch {
        continue;
      }
      for (const m of cls?.methods ?? []) {
        let ir;
        try {
          ir = toIr(parse(new Body(), lex(m.body)), {catalogue: {}, signature: m});
        } catch {
          continue;
        }
        const inputs = (m.parameters ?? []).filter((p) => isTableParam(p) && p.direction === "IN")
          .map((p) => String(p.name).toUpperCase());
        const scans = [...new Set(scansOf(ir.rel))];
        // self-contained: every relation it reads is one the caller supplies
        if (scans.length > 0 && scans.every((t) => inputs.includes(t))) {
          found.push({method: `${cls.name ?? "?"}=>${m.name}`, body: m.body, ir, inputs, scans});
        }
      }
    }
  }
  return found;
}

if (basename(process.argv[1] ?? "") === "check-corpus.mjs") {
  const list = candidates(process.argv[2]);
  console.log(`${list.length} corpus bodies read nothing but their own IN table parameters`);
  for (const one of list.slice(0, 20)) {
    const schema = (() => {
      try {
        return schemaOf(one.ir.rel, {});
      } catch {
        return {};
      }
    })();
    const dangerous = adversarialRows(one.ir.rel, schema);
    console.log(`\n${one.method}`);
    console.log(`  reads ${one.scans.join(", ")}`);
    if (dangerous.length === 0) {
      console.log("  the plan has no expression that can diverge: nothing to ask of it");
    } else {
      for (const r of dangerous) {
        console.log(`  row  ${r.column} = ${JSON.stringify(r.value)}  -- ${r.why}${r.known ? "" : "  (column not in the schema)"}`);
      }
    }
  }
  process.exit(0);
}
