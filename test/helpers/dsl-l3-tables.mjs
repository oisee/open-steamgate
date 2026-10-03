import {readdirSync, readFileSync} from "node:fs";
import {basename, join} from "node:path";

// Discover every L3 table so new runner dependencies reach all copy mutants.
export function l3TableDependencies() {
  return readdirSync("src/dsl").filter((file) => /^zosd_l3_.*\.tabl\.xml$/.test(file)).sort()
    .map((file) => join("src/dsl", file))
    .concat(readdirSync("src/l2demo").filter((file) => /^zl3_.*_r.*\.(tabl|ttyp)\.xml$|^zl3_.*_rfc\.fugr\.(?:.*\.)?(?:xml|abap)$/.test(file))
      .map((file) => join("src/l2demo", file)));
}

// Every transparent L3 table by name, for cleanup between cases: the same
// discovery as above, so a table added later is cleared without editing a list.
export function l3TableNames() {
  return l3TableDependencies().filter((file) => file.endsWith(".tabl.xml") && /<TABCLASS>TRANSP<\/TABCLASS>/.test(readFileSync(file, "utf8")))
    .map((file) => basename(file, ".tabl.xml"));
}
