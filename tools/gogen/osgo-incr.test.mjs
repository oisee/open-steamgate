// The per-object front-end cache (osgo-incr.mjs) over a small tree: a fast
// build -- the live generation's cache plus fresh lowerings of the edited
// objects and their dependents -- must produce the same program a full front
// end produces of the same tree, byte for byte where the build embeds it
// (the emitted Go), and the refusals must be the doubtful cases.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {columnRegistry} from "./frontend.mjs";
import {incrAssemble, incrRecorder, objectOf, registryFiles} from "./osgo-incr.mjs";

const sources = {
  "app/zif_incr_types.intf.abap": `INTERFACE zif_incr_types PUBLIC.
  TYPES: BEGIN OF ty_pair, a TYPE i, b TYPE i, END OF ty_pair.
  TYPES ty_nr TYPE i.
  TYPES ty_range TYPE RANGE OF i.
  CONSTANTS co_version TYPE i VALUE 3.
  METHODS half IMPORTING n TYPE i RETURNING VALUE(r) TYPE i.
  METHODS clip IMPORTING it TYPE zif_incr_types=>ty_range RETURNING VALUE(r) TYPE i.
ENDINTERFACE.`,
  "app/zcl_incr_base.clas.abap": `CLASS zcl_incr_base DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_incr_types.
    METHODS compute IMPORTING n TYPE i RETURNING VALUE(r) TYPE i.
ENDCLASS.
CLASS zcl_incr_base IMPLEMENTATION.
  METHOD compute.
    r = n.
    IF r > 10.
      r = r - 1.
    ENDIF.
  ENDMETHOD.
  METHOD zif_incr_types~half.
    r = n.
    WHILE r > 1.
      r = r - 2.
    ENDWHILE.
  ENDMETHOD.
ENDCLASS.`,
  "app/zcl_incr_impl.clas.abap": `CLASS zcl_incr_impl DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_incr_types.
    METHODS pairsum IMPORTING is_pair TYPE zif_incr_types=>ty_pair RETURNING VALUE(r) TYPE i.
ENDCLASS.
CLASS zcl_incr_impl IMPLEMENTATION.
  METHOD zif_incr_types~half.
    DATA base TYPE REF TO zcl_incr_base.
    CREATE OBJECT base.
    r = base->zif_incr_types~half( n ).
  ENDMETHOD.
  METHOD pairsum.
    r = is_pair-a + is_pair-b + zif_incr_types=>co_version.
  ENDMETHOD.
ENDCLASS.`,
  "app/zcl_incr_caller.clas.abap": `CLASS zcl_incr_caller DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run IMPORTING n TYPE i RETURNING VALUE(r) TYPE string.
ENDCLASS.
CLASS zcl_incr_caller IMPLEMENTATION.
  METHOD run.
    DATA impl TYPE REF TO zcl_incr_impl.
    DATA pair TYPE zif_incr_types=>ty_pair.
    DATA range TYPE zif_incr_types=>ty_range.
    DATA intf TYPE REF TO zif_incr_types.
    CREATE OBJECT impl TYPE zcl_incr_impl.
    pair-a = impl->pairsum( pair ).
    DATA wa LIKE LINE OF range.
    wa-sign = 'I'.
    wa-option = 'EQ'.
    wa-low = n.
    APPEND wa TO range.
    CREATE OBJECT intf TYPE zcl_incr_impl.
    r = |{ intf->half( n ) }/{ intf->clip( range ) }/{ zif_incr_types=>co_version }|.
  ENDMETHOD.
ENDCLASS.`,
  "app/zcl_incr_hot.clas.abap": `CLASS zcl_incr_hot DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS key IMPORTING travelid TYPE string RETURNING VALUE(r) TYPE string.
ENDCLASS.
CLASS zcl_incr_hot IMPLEMENTATION.
  METHOD key.
    IF travelid IS INITIAL.
      r = 'Key TravelId missing'.
    ENDIF.
    r = |hot:{ travelid }|.
  ENDMETHOD.
ENDCLASS.`,
  "app/zcl_incr_top.clas.abap": `CLASS zcl_incr_top DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_incr_top IMPLEMENTATION.
  METHOD run.
    DATA hot TYPE REF TO zcl_incr_hot.
    CREATE OBJECT hot.
    rv = |top:{ hot->key( 'x' ) }|.
  ENDMETHOD.
ENDCLASS.`,
};

const edit = (root, file, from, to) => writeFileSync(join(root, file), readFileSync(join(root, file), "utf8").replace(from, to));

/** a canonical text of any lowered value: v8 bytes differ across a
 *  serialize/deserialize round trip for equal data, this does not */
function canon(value, depth = 0) {
  if (value === null || ["undefined", "string", "number", "boolean"].includes(typeof value)) return [typeof value, String(value)];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (depth > 200) return ["deep", ""]; // a guard only: lowered values are acyclic
  if (Array.isArray(value)) return ["array", value.map((v) => canon(v, depth + 1))];
  if (value instanceof Map) return ["map", [...value].map(([k, v]) => [canon(k, depth + 1), canon(v, depth + 1)])];
  if (value instanceof Set) return ["set", [...value].map((v) => canon(v, depth + 1))];
  return ["object", Object.keys(value).sort().map((k) => [k, canon(value[k], depth + 1)])];
}
const text = (value) => JSON.stringify(canon(value));

function tree() {
  const root = mkdtempSync(join(tmpdir(), "osgo-incr-"));
  for (const [file, text] of Object.entries(sources)) {
    mkdirSync(join(root, file, ".."), {recursive: true});
    writeFileSync(join(root, file), text);
  }
  return root;
}

const objectNames = (root) => [...registryFiles([join(root, "app")], new Set(), new Set()).values()].map((k) => k.slice(5).toLowerCase());

/** the program a full front end makes of the tree as it is now */
const fullProgram = (root) => compileProgram({folders: [join(root, "app")], objects: objectNames(root), tolerant: true});

/** a cache of the tree as it is now, the way a full build records it */
const writeCache = (root, gen = "live1") => {
  const folders = [join(root, "app")];
  const recorder = incrRecorder({root, folders, hidden: new Set(), objects: objectNames(root), includeTests: new Set()});
  const program = compileProgram({folders, objects: objectNames(root), tolerant: true, incr: recorder});
  return {program, written: recorder.finish({gen}), gen};
};

const emitted = (program) => emitGo(program);

test("objectOf maps a file of an object to its kind", () => {
  assert.deepEqual(objectOf("src/zcl_a.clas.abap"), ["CLAS", "ZCL_A"]);
  assert.deepEqual(objectOf("src/zcl_a.clas.locals_imp.abap"), ["CLAS", "ZCL_A"]);
  assert.deepEqual(objectOf("src/zif_b.intf.abap"), ["INTF", "ZIF_B"]);
  assert.deepEqual(objectOf("src/zstg_t.tabl.xml"), ["DDIC", "ZSTG_T"]);
  assert.deepEqual(objectOf("src/zfg.fugr.xml"), ["FUGR", "ZFG"]);
  assert.deepEqual(objectOf("src/readme.md"), ["OTHER", "README"]);
});

for (const [name, change] of [
  ["a method body (a literal in the edited class)", (root) => edit(root, "app/zcl_incr_hot.clas.abap", "'Key TravelId missing'", "'Key TravelId missing (edited)'")],
  ["a new method, defined and implemented", (root) => {
    edit(root, "app/zcl_incr_hot.clas.abap", "METHODS key IMPORTING", "METHODS twin RETURNING VALUE(r) TYPE i.\n    METHODS key IMPORTING");
    edit(root, "app/zcl_incr_hot.clas.abap", "METHOD key.", "METHOD twin.\n    r = 2.\n  ENDMETHOD.\n  METHOD key.");
  }],
  ["an interface constant read by other objects", (root) => edit(root, "app/zif_incr_types.intf.abap", "VALUE 3.", "VALUE 4.")],
  ["an interface gains a method an implementer provides", (root) => {
    edit(root, "app/zif_incr_types.intf.abap", "METHODS half", "METHODS third IMPORTING n TYPE i RETURNING VALUE(r) TYPE i.\n  METHODS half");
    edit(root, "app/zcl_incr_base.clas.abap", "METHOD zif_incr_types~half.", "METHOD zif_incr_types~third.\n    r = n.\n  ENDMETHOD.\n  METHOD zif_incr_types~half.");
  }],
]) {
  test(`a fast build is the full build: ${name}`, () => {
    const root = tree();
    try {
      writeCache(root);
      change(root);
      const reference = fullProgram(root);
      const attempt = incrAssemble({root, folders: [join(root, "app")], objects: objectNames(root), hidden: new Set(), includeTests: new Set(),
        proof: {ok: true, base: "live1", changed: changedFiles(root)}});
      assert.equal(attempt.ok, true, attempt.reason);
      assert.ok(attempt.lowered.includes("CLAS ZCL_INCR_HOT") || attempt.lowered.includes("INTF ZIF_INCR_TYPES"));
      assert.equal(attempt.program.classes.length, reference.classes.length);
      assert.equal(text(attempt.program.classes), text(reference.classes));
      assert.equal(text([...attempt.program.structs]), text([...reference.structs]));
      assert.equal(text([...attempt.program.consts]), text([...reference.consts]));
      assert.equal(text([...attempt.program.interfaceMethods]), text([...reference.interfaceMethods]));
      assert.equal(text([...attempt.program.events]), text([...reference.events]));
      assert.equal(text(attempt.program.exceptionSupers), text(reference.exceptionSupers));
      assert.equal(text([...attempt.program.rtti.structs]), text([...reference.rtti.structs]));
      assert.equal(JSON.stringify(columnRegistry(attempt.program)), JSON.stringify(columnRegistry(reference)));
      assert.equal(emitted(attempt.program), emitted(reference));
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
}

/** the files this test edited (the cache's proof names root-relative files) */
function changedFiles(root) {
  return [...registryFiles([join(root, "app")], new Set(), new Set()).keys()]
    .map((f) => f.slice(root.length + 1))
    .filter((f) => readFileSync(join(root, f), "utf8") !== sources[f]);
}

test("a cache of another generation is refused, and so is an unreadable entry", async () => {
  const root = tree();
  try {
    writeCache(root);
    edit(root, "app/zcl_incr_hot.clas.abap", "'Key TravelId missing'", "'x'");
    const wrong = incrAssemble({root, folders: [join(root, "app")], objects: objectNames(root), hidden: new Set(), includeTests: new Set(),
      proof: {ok: true, base: "other", changed: ["app/zcl_incr_hot.clas.abap"]}});
    assert.equal(wrong.ok, false);
    assert.match(wrong.reason, /no per-object cache/);
    rmSync(join(root, "build", "osgo-incr", "live1", "e"), {recursive: true, force: true});
    const gone = incrAssemble({root, folders: [join(root, "app")], objects: objectNames(root), hidden: new Set(), includeTests: new Set(),
      proof: {ok: true, base: "live1", changed: ["app/zcl_incr_hot.clas.abap"]}});
    assert.equal(gone.ok, false);
    assert.match(gone.reason, /unreadable/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("a syntax error in the edited object refuses the fast build", () => {
  const root = tree();
  try {
    writeCache(root);
    edit(root, "app/zcl_incr_hot.clas.abap", "r = |hot:{ travelid }|.", "r = zcl_incr_hot=>nope( ).");
    const attempt = incrAssemble({root, folders: [join(root, "app")], objects: objectNames(root), hidden: new Set(), includeTests: new Set(),
      proof: {ok: true, base: "live1", changed: ["app/zcl_incr_hot.clas.abap"]}});
    assert.equal(attempt.ok, false);
    assert.match(attempt.reason, /syntax errors in re-lowered objects/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("the cache is refused when the front end itself changed (tool identity)", () => {
  const root = tree();
  try {
    writeCache(root);
    edit(root, "app/zcl_incr_hot.clas.abap", "'Key TravelId missing'", "'x'");
    const file = join(root, "build", "osgo-incr", "live1", "index.json");
    const index = JSON.parse(readFileSync(file, "utf8"));
    index.tool = "something-else";
    writeFileSync(file, JSON.stringify(index));
    const attempt = incrAssemble({root, folders: [join(root, "app")], objects: objectNames(root), hidden: new Set(), includeTests: new Set(),
      proof: {ok: true, base: "live1", changed: ["app/zcl_incr_hot.clas.abap"]}});
    assert.equal(attempt.ok, false);
    assert.match(attempt.reason, /front end changed/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
