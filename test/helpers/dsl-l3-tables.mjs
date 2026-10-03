import {readdirSync} from "node:fs";
import {join} from "node:path";

// Discover every L3 table so new runner dependencies reach all copy mutants.
export function l3TableDependencies() {
  return readdirSync("src/dsl").filter((file) => /^zosd_l3_.*\.tabl\.xml$/.test(file)).sort()
    .map((file) => join("src/dsl", file))
    .concat(readdirSync("src/l2demo").filter((file) => /^zl3_.*_r.*\.(tabl|ttyp)\.xml$|^zl3_.*_rfc\.fugr\.(?:.*\.)?(?:xml|abap)$/.test(file))
      .map((file) => join("src/l2demo", file)));
}
