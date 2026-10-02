import {createRequire} from "node:module";
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo, referencedClasses} from "./emit-go.mjs";
import {libraryPath} from "../osd-lib-path.mjs";

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve("@abaplint/transpiler/package.json"))("@abaplint/core");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const folders = [join(here, "testdata"), join(libraryPath(root, "open-abap-core"), "src"), join(libraryPath(root, "ajson"), "src/core")];
const objects = readdirSync(folders[0], {recursive: true}).filter((f) => /\.(clas|intf|fugr)\.(abap|xml)$/.test(f))
  .map((f) => f.split("/").at(-1).split(".")[0].replaceAll("#", "/").toUpperCase());

test("growing testdata closure emits the same Go bytes as a fresh final compile", () => {
  const wanted = new Set(objects), session = {};
  let program, rounds = 0, reused = 0;
  const libraryReused = new Set();
  for (; rounds < 12; rounds++) {
    program = compileProgram({folders, objects: [...wanted], registry: program?.reg, session});
    reused += program.frontendCounts.reused;
    program.frontendCounts.reusedClasses.forEach((name) => libraryReused.add(name));
    const refs = new Set([...referencedClasses(program), ...program.missing]);
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.e === "call") {
        if (node.owner) refs.add(node.owner);
        if (node.receiver?.type?.k === "ref" && !node.receiver.type.intf) refs.add(node.receiver.type.name);
      }
      if (node.e === "new") refs.add(node.cls);
      for (const [k, v] of Object.entries(node)) if (k !== "type") visit(v);
    };
    for (const name of wanted) {
      const sup = program.reg.getObject("CLAS", name)?.getDefinition()?.getSuperClass();
      if (sup) refs.add(sup.toUpperCase());
    }
    for (const c of program.classes) {
      if (c.super) refs.add(c.super);
      for (const m of c.methods) visit(m.body);
    }
    const more = [...refs].filter((n) => !wanted.has(n) && !n.includes(":")
      && (program.reg.getObject("CLAS", n) || program.reg.getObject("INTF", n)));
    if (!more.length) break;
    more.forEach((n) => wanted.add(n));
  }
  assert.ok(rounds > 0 && rounds < 12, "closure grows and settles");
  assert.ok(reused > 0, "closure exercises cached lowerings");
  assert.ok(libraryReused.has("CX_ROOT"), "dependency-sensitive library lowering is reused across growth");
  const fresh = compileProgram({folders, objects: [...wanted]});
  const actual = emitGo(program), expected = emitGo(fresh);
  const offset = [...actual].findIndex((c, i) => c !== expected[i]);
  assert.ok(actual === expected, `Go differs at ${offset}: ${JSON.stringify(actual.slice(offset - 90, offset + 200))} vs ${JSON.stringify(expected.slice(offset - 90, offset + 200))}`);
  assert.deepEqual(program.skipped, fresh.skipped);
  const repeated = compileProgram({folders, objects: [...wanted], registry: program.reg, session});
  assert.ok(repeated.frontendCounts.reused > 0);
  assert.equal(emitGo(repeated), emitGo(fresh));
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
    assert.ok(next.frontendCounts.reused >= 2);
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
