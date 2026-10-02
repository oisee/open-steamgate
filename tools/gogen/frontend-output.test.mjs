import {createRequire} from "node:module";
import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {libraryPath} from "../osd-lib-path.mjs";

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve("@abaplint/transpiler/package.json"))("@abaplint/core");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
// Captured from dacc7961 before changing the frontend, using the locked libs.
const expected = JSON.parse(readFileSync(join(here, "frontend-output.json"), "utf8"));
test("all gogen testdata emits the same Go bytes as the original frontend", () => {
  const args = {
    folders: [join(here, "testdata"), join(libraryPath(root, "open-abap-core"), "src"), join(libraryPath(root, "ajson"), "src/core")],
    objects: [...expected.objects, ...expected.core],
  };
  const session = {};
  const program = compileProgram({...args, session});
  const go = emitGo(program);
  assert.equal(program.classes.length, expected.classes);
  assert.equal(program.classes.reduce((n, c) => n + c.methods.length, 0), expected.methods);
  assert.equal(Buffer.byteLength(go), expected.bytes);
  assert.equal(createHash("sha256").update(go).digest("hex"), expected.sha256);
  const reused = compileProgram({...args, registry: program.reg, session});
  assert.ok(reused.frontendCounts.reused > 0);
  assert.equal(emitGo(reused), go);
});

test("closure reuse retains refusals and recompiles dependency-sensitive callers", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-closure-"));
  const source = (name, body) => `CLASS ${name} DEFINITION PUBLIC.
PUBLIC SECTION.
CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS ${name} IMPLEMENTATION.
METHOD run.
${body}
ENDMETHOD.
ENDCLASS.`;
  try {
    const math = source("zcl_math", "DATA x TYPE i. x = 3. helper( ). rv = x + 1.")
      .replace("ENDCLASS.\nCLASS", "CLASS-METHODS helper.\nENDCLASS.\nCLASS")
      .replace("ENDMETHOD.\nENDCLASS.", "ENDMETHOD.\nMETHOD helper.\nENDMETHOD.\nENDCLASS.");
    writeFileSync(join(dir, "zcl_math.clas.abap"), math);
    writeFileSync(join(dir, "zcl_caller.clas.abap"), source("zcl_caller", "rv = zcl_dependency=>run( )."));
    writeFileSync(join(dir, "zcl_dependency.clas.abap"), source("zcl_dependency", "rv = 7."));
    writeFileSync(join(dir, "zcl_refusal.clas.abap"), source("zcl_refusal", "DATA x TYPE int8. DATA y TYPE x. y = x."));
    const args = {folders: [dir], objects: ["ZCL_MATH", "ZCL_CALLER", "ZCL_REFUSAL"], tolerant: true};
    const session = {};
    const first = compileProgram({...args, session});
    assert.ok(first.missing.has("ZCL_DEPENDENCY"));
    assert.equal(first.classes.find((c) => c.name === "ZCL_CALLER").methods[0].body[0].s, "stub");
    const all = {...args, objects: [...args.objects, "ZCL_DEPENDENCY"]};
    const next = compileProgram({...all, registry: first.reg, session});
    assert.equal(next.frontendCounts.reused, 2);
    assert.notEqual(next.classes.find((c) => c.name === "ZCL_CALLER").methods[0].body[0].s, "stub");
    assert.deepEqual(next.skipped, compileProgram(all).skipped);
    assert.equal(emitGo(next), emitGo(compileProgram(all)));
    // A registry edit invalidates both diagnostics and class lowering.
    const file = first.reg.getObject("CLAS", "ZCL_MATH").getMainABAPFile();
    const edited = file.getRaw().replace("x = 3", "x = 9");
    first.reg.updateFile(new core.MemoryFile(file.getFilename(), edited));
    writeFileSync(join(dir, "zcl_math.clas.abap"), edited);
    const changed = compileProgram({...all, registry: first.reg, session});
    assert.equal(changed.frontendCounts.reused, 0);
    assert.notEqual(emitGo(changed), emitGo(next));
    assert.equal(emitGo(changed), emitGo(compileProgram(all)));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
