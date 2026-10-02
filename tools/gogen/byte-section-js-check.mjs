// Check the unchanged JS runtime against the P1 A4H oracle and ABAPiti r1-r6.
// This is a measurement runner: mismatches are reported and exit 1.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {transpile} from "../osd-transpile.mjs";
import {home} from "./home.mjs";

const base = JSON.parse(readFileSync(resolve(home, "abap_transpile.json"), "utf8"));
const output = "tools/gogen/.out/js-byte-section";
await transpile({root: home, config: {
  input_folder: ["tools/gogen/testdata"],
  input_filter: ["zcl_(abapiti_repro_(bytes|mem)|gogen_t_byteoracle)\\.clas\\."],
  output_folder: output, write_unit_tests: true, libs: [base.libs[0]],
  options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true},
}});
const load = (file) => import(pathToFileURL(resolve(home, output, file)).href);
await load("init.mjs");
const {ltcl_oracle} = await load("zcl_gogen_t_byteoracle.clas.testclasses.mjs");
const {ltcl_bytes} = await load("zcl_abapiti_repro_bytes.clas.testclasses.mjs");
const rows = [];
for (const [cls, methods] of [
  [ltcl_oracle, Array.from({length: 12}, (_, i) => `p1_${String(i + 1).padStart(2, "0")}`)],
  [ltcl_bytes, ["r1_replace_middle", "r2_replace_at_start", "r3_replace_at_end",
    "r4_replace_with_zero_bytes", "r5_replace_one_byte_var_off", "r6_replace_out_of_range"]],
]) {
  for (const method of methods) {
    const instance = await new cls().constructor_();
    const run = instance.FRIENDS_ACCESS_INSTANCE[method];
    if (typeof run !== "function") throw new Error(`missing test method ${method}`);
    try {
      await run();
      rows.push({method, status: "SUCCESS"});
    } catch (err) {
      rows.push({method, status: "FAILED", message: err.message,
        actual: err.actual?.get?.(), expected: err.expected?.get?.()});
    }
  }
}
console.log(JSON.stringify(rows, null, 2));
process.exitCode = rows.some((r) => r.status === "FAILED") ? 1 : 0;
