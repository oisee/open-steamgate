#!/usr/bin/env node
// The naming rule as a check rather than as a list (backlog G.1d).
//
// The rule, as Alice set it in G.1c and fable-osd sharpened when she caught
// her own README headline breaking it:
//
//   **a name we give ourselves carries no third-party brand word; a
//   statement of fact about their software keeps it, because without it the
//   sentence would be false.**
//
// "in a real SAP system code is branched by transports and data is not
// branched at all" stays exactly as it is. A page title does not.
//
// Why a check and not a document: "no live identifiers" sat in CLAUDE.md
// from the first week and did no work at all -- both leaks were caught by
// attention, and attention runs out. A list of what we call what goes stale
// in silence, because nothing ever reads it.
//
// **A text scan cannot tell the two cases apart, so it does not try.** The
// *position* carries the distinction: a `<title>`, a tile text, a pack name,
// an ICF node text and a class description are all places where we are
// naming ourselves, and prose is not. So positions are what is checked and
// prose stays a person's job. That limit is stated rather than worked
// around; working around it would mean guessing at sentences, and a check
// that guesses is a check that gets switched off.
//
//   node tools/osd-naming-scan.mjs [--json]
//
// Exit 0 clean, 1 with findings, 2 when it could not do its job.
import {readFileSync, existsSync, readdirSync, statSync} from "node:fs";
import {basename, join, relative, resolve} from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

// The words, and the reason the list is short. Every one of these is a name
// somebody else owns and we have no claim to. `ABAP` is deliberately **not**
// here: the agreed headline is "An ABAP application server you can clone",
// and a check that failed the sentence it was written to protect would be
// wrong about its own rule -- ABAP is the language this runs, not a brand we
// are borrowing.
//
// Transaction codes (SE16, SE80, ST05, SM50) are deliberately not here
// either, and that is a judgement rather than an oversight: in a title they
// are nearly always a statement of fact about SAP's software -- what the
// screen is called over there -- so flagging them would flag mostly true
// sentences, and a check that cries wolf gets ignored. That is the one
// lesson the leak scan already paid for.
const BRANDS = [
  "SAP", "SAPUI5", "Fiori", "HANA", "NetWeaver", "S/4HANA", "S/4", "Eclipse",
  "ERP", "SuccessFactors", "Ariba",
];

const brandPattern = new RegExp(`(?<![A-Za-z0-9])(${
  BRANDS.map((b) => b.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")
})(?![A-Za-z0-9])`, "gi");

/** every file under a directory, skipping what is not ours to name */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "build", "gen", "output", "upstream", ".local"].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** The naming positions. Each says where it looks and what it pulls out, and
 *  the name of the position is what a finding is reported under -- because
 *  "a brand word in a <title>" and "a brand word in a paragraph" are
 *  different facts and only one of them is a defect. */
const POSITIONS = [
  {
    name: "<title>",
    files: (f) => /\.(html|abap)$/.test(f),
    find: (text) => [...text.matchAll(/<title>([^<]{1,200})<\/title>/gi)].map((m) => m[1]),
  },
  {
    name: "launchpad tile",
    files: (f) => basename(f) === "manifest.json",
    find: (text) => {
      const out = [];
      try {
        const app = JSON.parse(text)["sap.app"] ?? {};
        for (const key of ["title", "subTitle", "description"]) {
          if (typeof app[key] === "string") out.push(app[key]);
        }
      } catch {
        // a manifest we cannot read is not a naming finding; the build says so
      }
      return out;
    },
  },
  {
    name: "launchpad shell",
    files: (f) => basename(f) === "flp.html",
    find: (text) => [
      ...[...text.matchAll(/shellLogo:\s*"([^"]*)"/g)].map((m) => m[1]),
      ...[...text.matchAll(/\btitle:\s*"([^"]{1,120})"/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bsubtitle:\s*"([^"]{1,120})"/g)].map((m) => m[1]),
    ],
  },
  {
    name: "pack",
    files: (f) => basename(f) === "osd-pack.json",
    find: (text) => {
      try {
        const pack = JSON.parse(text);
        return ["name", "title", "description"].map((k) => pack[k]).filter((v) => typeof v === "string");
      } catch {
        return [];
      }
    },
  },
  {
    name: "ICF node text",
    files: (f) => /\.sicf\.xml$/.test(f),
    find: (text) => [...text.matchAll(/<(?:DESCRIPT|ICFDOCU|TEXT)>([^<]{1,200})<\//gi)].map((m) => m[1]),
  },
  {
    name: "object description",
    files: (f) => /\.(clas|intf|prog|fugr|tabl|dtel|doma|ddls|tran)\.xml$/.test(f),
    find: (text) => [...text.matchAll(/<(?:DESCRIPT|DDTEXT|STEXT|TTEXT)>([^<]{1,200})<\//gi)].map((m) => m[1]),
  },
  {
    name: "service inventory text",
    files: (f) => /zosd_svc.*\.tabu\.json$/.test(basename(f)),
    find: (text) => {
      try {
        const rows = JSON.parse(text);
        const list = Array.isArray(rows) ? rows : (rows.values ?? rows.rows ?? []);
        return list.map((r) => r?.TEXT ?? r?.text).filter((v) => typeof v === "string");
      } catch {
        return [];
      }
    },
  },
];

function allowList() {
  const file = join(ROOT, ".naming-allow.json");
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const entries = parsed.allow ?? [];
    for (const entry of entries) {
      if (!entry.reason) {
        console.error(`.naming-allow.json: an entry for ${entry.file} has no reason`);
        process.exit(2);
      }
    }
    return entries;
  } catch (error) {
    console.error(`.naming-allow.json could not be read: ${error.message}`);
    process.exit(2);
  }
}

export function scan(root = ROOT) {
  const allowed = allowList();
  const files = walk(root);
  const findings = [];
  const seen = new Set();
  let looked = 0;
  for (const full of files) {
    const rel = relative(root, full);
    const applicable = POSITIONS.filter((p) => p.files(rel));
    if (applicable.length === 0) continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    looked += 1;
    for (const position of applicable) {
      for (const value of position.find(text)) {
        for (const hit of value.matchAll(brandPattern)) {
          const excused = allowed.some((a) =>
            (a.file === rel || a.file === undefined) && a.value === value);
          if (excused) continue;
          // one finding per (file, position, value, word): a position that
          // looks in two places for the same thing reports it twice, and a
          // count that double-counts is a count nobody trusts
          const key = `${rel}\u0000${position.name}\u0000${value}\u0000${hit[0]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({file: rel, position: position.name, value, word: hit[0]});
        }
      }
    }
  }
  return {looked, findings};
}

if (basename(process.argv[1] ?? "") === "osd-naming-scan.mjs") {
  const {looked, findings} = scan();
  if (looked === 0) {
    // the same rule the leak scan learned: a scan that read nothing says so
    // rather than printing the clean line
    console.error("osd-naming-scan: no naming position was read at all — this is not a pass");
    process.exit(2);
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(findings, undefined, 2));
  } else {
    for (const f of findings) {
      console.log(`${f.file}\n  ${f.position}: ${JSON.stringify(f.value)}\n  -> "${f.word}" in a name we give ourselves`);
    }
    console.log(`\nosd-naming-scan: ${looked} files carrying a naming position, ${findings.length} finding(s)`);
    if (findings.length > 0) {
      console.log("A name we give ourselves carries no third-party brand word. A statement of");
      console.log("fact about their software keeps it — and if this is one, put it in");
      console.log(".naming-allow.json with the reason, which is what tells an exception from a");
      console.log("way of making the build green.");
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
