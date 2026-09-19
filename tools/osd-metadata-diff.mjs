// Our $metadata against a system's, for the same model.
//
//   node tools/osd-metadata-diff.mjs <ours.xml> <theirs.xml> [--ours ZSTG_DEMO] [--theirs ZOSD_002_DEMO]
//
// The first comparison this project has ever made between itself and a
// system. Everything before it compared our two implementations with each
// other, and on 2026-09-19 that is exactly what let three defects stand for
// months: both sides padded an object name to 34, both omitted a BOM, both
// made the same invalid node ids. A test that two implementations agree is
// not a test that either is right.
//
// One masking rule, and it is named and reported rather than applied
// quietly: the project is called ZSTG_DEMO here and ZOSD_002_DEMO there,
// because a system needs a package prefix per attempt and this tree does
// not. Everything else must match or it is a finding.
import {readFileSync} from "node:fs";
import {runsAs} from "./osd-main.mjs";

/** Pull the interesting shapes out, because a line diff of XML reports
 *  whitespace and attribute order as though they were content. What matters
 *  is which types, sets, properties and function imports exist and what they
 *  are made of. */
export function shapes(xml) {
  const grab = (re) => [...xml.matchAll(re)].map((m) => m.slice(1));
  return {
    entityTypes: grab(/<EntityType\s+Name="([^"]+)"/g).map((m) => m[0]).sort(),
    entitySets: grab(/<EntitySet\s+[^>]*Name="([^"]+)"[^>]*EntityType="([^"]+)"/g)
      .map(([n, t]) => `${n}: ${t}`).sort(),
    properties: grab(/<Property\s+Name="([^"]+)"[^>]*Type="([^"]+)"/g)
      .map(([n, t]) => `${n}: ${t}`).sort(),
    keys: grab(/<PropertyRef\s+Name="([^"]+)"/g).map((m) => m[0]).sort(),
    navigation: grab(/<NavigationProperty\s+Name="([^"]+)"/g).map((m) => m[0]).sort(),
    associations: grab(/<Association\s+Name="([^"]+)"/g).map((m) => m[0]).sort(),
    functionImports: grab(/<FunctionImport\s+[^>]*Name="([^"]+)"/g).map((m) => m[0]).sort(),
    parameters: grab(/<Parameter\s+Name="([^"]+)"[^>]*Type="([^"]+)"/g)
      .map(([n, t]) => `${n}: ${t}`).sort(),
  };
}

/** The one masking rule. It has a name, a reason, and it says when it fired. */
export const renameProject = (xml, from, to) =>
  (from === undefined || to === undefined) ? xml : xml.split(from).join(to);

export function compare(ours, theirs) {
  const a = shapes(ours);
  const b = shapes(theirs);
  const out = [];
  let same = 0;
  for (const key of Object.keys(a)) {
    const onlyOurs = a[key].filter((x) => !b[key].includes(x));
    const onlyTheirs = b[key].filter((x) => !a[key].includes(x));
    if (onlyOurs.length === 0 && onlyTheirs.length === 0) { same += 1; continue; }
    out.push({key, onlyOurs, onlyTheirs, ours: a[key].length, theirs: b[key].length});
  }
  return {same, kinds: Object.keys(a).length, differences: out};
}

if (runsAs("osd-metadata-diff.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv[i + 1]; };
  const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (files.length !== 2) {
    console.error("usage: osd-metadata-diff.mjs <ours.xml> <theirs.xml> [--ours NAME] [--theirs NAME]");
    process.exit(2);
  }
  const ourName = flag("ours");
  const theirName = flag("theirs");
  const ours = renameProject(readFileSync(files[0], "utf8"), ourName, theirName);
  const theirs = readFileSync(files[1], "utf8");
  if (ourName !== undefined) console.log(`masked by rule: project name ${ourName} -> ${theirName}\n`);

  const r = compare(ours, theirs);
  console.log(`${r.same} of ${r.kinds} kinds identical\n`);
  for (const d of r.differences) {
    console.log(`  ${d.key}: ours ${d.ours}, theirs ${d.theirs}`);
    for (const x of d.onlyOurs) console.log(`    only ours:   ${x}`);
    for (const x of d.onlyTheirs) console.log(`    only theirs: ${x}`);
  }
  if (r.differences.length === 0) {
    console.log("No difference in any kind. Our $metadata and the system's describe the same service.");
  }
  process.exit(r.differences.length === 0 ? 0 : 1);
}
