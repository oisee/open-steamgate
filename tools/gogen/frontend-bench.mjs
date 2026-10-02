// Generated locals and arithmetic in one method, stressing frontend class size.
// node tools/gogen/frontend-bench.mjs [1000 5000 20000]
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {performance} from "node:perf_hooks";
import {compileProgram} from "./frontend.mjs";

const sizes = process.argv.slice(2).map(Number);
for (const size of sizes.length ? sizes : [1000, 5000, 20000]) {
  if (!Number.isSafeInteger(size) || size < 20) throw new Error("sizes must be integers >= 20");
  const dir = mkdtempSync(join(tmpdir(), "gogen-scale-"));
  try {
    const count = Math.floor((size - 9) / 4);
    const declarations = Array.from({length: count}, (_, i) => `DATA v${i} TYPE int8.`);
    const body = Array.from({length: count}, (_, i) => `v${i} = ${i}.\nv${i} = v${i} + 1.\nrv = rv + v${i}.`);
    const source = ["CLASS zcl_scale DEFINITION PUBLIC.", "PUBLIC SECTION.", "CLASS-METHODS run RETURNING VALUE(rv) TYPE int8.", "ENDCLASS.", "CLASS zcl_scale IMPLEMENTATION.", "METHOD run.", ...declarations, ...body, "ENDMETHOD.", "ENDCLASS.", ""].join("\n");
    writeFileSync(join(dir, "zcl_scale.clas.abap"), source);
    const started = performance.now();
    const program = compileProgram({folders: [dir], objects: ["ZCL_SCALE"]});
    const ms = performance.now() - started;
    if (program.skipped.length || program.classes[0]?.methods.length !== 1) throw new Error(program.skipped.join("\n") || "method missing");
    console.log(JSON.stringify({lines: source.split("\n").length - 1, bytes: Buffer.byteLength(source), locals: count, frontendMs: Math.round(ms), msPerLine: +(ms / (source.split("\n").length - 1)).toFixed(3)}));
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
