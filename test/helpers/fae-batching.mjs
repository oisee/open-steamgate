// Does the tree under test batch FOR ALL ENTRIES? (toolchain and build)
//
// ANOMALY-2026-09-30-fae-one-select-per-row: the published transpiler writes
// one SELECT per row of the driving table, and the pinned fork
// (libs.lock.json, linked by tools/osd-link.mjs; the batching is in the
// transpiler's generated code, the runtime only executes it) writes one per block of 50.
// A few tests count database calls ("50 driving rows are 1 call") and they
// can only pass on the fork. An `npm install` in a worktree quietly puts the
// published packages back, and the tests then fail with "expected 4 to equal
// 1", which reads like a bug in the test and not like the wrong toolchain.
//
// The check is a behaviour probe, not a provenance report: transpile a
// five-line FOR ALL ENTRIES with the transpiler in use, run the result on
// the runtime in use against a SELECT that only counts, and ask how many
// statements 120 driving rows made. Provenance (tools/osd-transpiler.mjs)
// says "linked", which is true of any local build, fork or not; the probe
// says what the build does, so a link to some other checkout is judged by
// its behaviour. It costs one tiny transpile, about a second.
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {modulesOf} from "../../tools/osd-transpile.mjs";

const ROWS = 120;

// the documented relinks are package.json's transpiler:local and runtime:local
export const RELINK = "relink the pinned transpiler (the published @abaplint/transpiler emits FOR ALL ENTRIES as one SELECT per row): TRANSPILER=<fork> npm run transpiler:local && TRANSPILER=<fork> npm run runtime:local; then rebuild (npm run transpile)";
export const STALE = "output/ was built by a transpiler without batched FAE: rebuild with npm run transpile";

// the block loop the fork's select.ts writes: `.slice(i, i + 50)`
const BLOCK = /\.slice\(\w+, \w+ \+ 50\)/;

const TABLE = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DD02V><TABNAME>ZFAE_PROBE</TABNAME><DDLANGUAGE>E</DDLANGUAGE><TABCLASS>TRANSP</TABCLASS><CONTFLAG>A</CONTFLAG></DD02V><DD03P_TABLE><DD03P><FIELDNAME>K</FIELDNAME><KEYFLAG>X</KEYFLAG><INTTYPE>C</INTTYPE><INTLEN>000008</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>000004</LENG><MASK>  CHAR</MASK></DD03P></DD03P_TABLE></asx:values></asx:abap></abapGit>`;

const PROGRAM = `REPORT zfae_probe.
TYPES: BEGIN OF ty, k TYPE c LENGTH 4, END OF ty.
DATA drv TYPE STANDARD TABLE OF ty WITH DEFAULT KEY.
DATA res TYPE STANDARD TABLE OF ty WITH DEFAULT KEY.
FIELD-SYMBOLS <r> TYPE ty.
DO ${ROWS} TIMES.
  APPEND INITIAL LINE TO drv ASSIGNING <r>.
  <r>-k = sy-index.
ENDDO.
SELECT k FROM zfae_probe INTO TABLE res FOR ALL ENTRIES IN drv WHERE k = drv-k.`;

// how many SELECT statements 120 driving rows made on this tree
export async function faeStatements(root = process.cwd()) {
  const {Transpiler, core} = modulesOf(root);
  const reg = new core.Registry();
  reg.addFile(new core.MemoryFile("zfae_probe.prog.abap", PROGRAM));
  reg.addFile(new core.MemoryFile("zfae_probe.tabl.xml", TABLE));
  const out = await new Transpiler({ignoreSourceMap: true}).run(reg);
  const code = out.objects.find((o) => o.filename === "zfae_probe.prog.mjs").chunk.getCode();

  const need = createRequire(join(root, "package.json"));
  const runtime = need("@abaplint/runtime");
  // `new ABAP()` and the probe write to the runtime's module-level sy
  // (subrc, tabix, index, datum, uzeit); a suite that froze the clock or set
  // sy-mandt would find it changed. Keep every field and put it back.
  const sy = syOf(root).get();
  const saved = Object.entries(sy).map(([name, field]) => [field, field.get()]);
  let calls = 0;
  // the runtime reaches for a global `abap`; borrow it and give it back, the
  // suite that asked may have its own. The constructor and the assignment are
  // inside the try: either may throw after having written to sy.
  const had = Object.getOwnPropertyDescriptor(globalThis, "abap");
  try {
    const abap = new runtime.ABAP();
    abap.statements.select = async () => { calls++; };
    globalThis.abap = abap;
    const run = Object.getPrototypeOf(async function () {}).constructor;
    await new run("abap", code)(abap);
  } finally {
    for (const [field, value] of saved) field.set(value);
    if (had) Object.defineProperty(globalThis, "abap", had);
    else delete globalThis.abap;
  }
  return calls;
}

// the default probe (OSD_FAE_ROOT points it at another tree, to see the
// failure without breaking this one); tests hand `requireBatchedFae` another one to fake a tree
export async function batchesFae(root = process.env.OSD_FAE_ROOT ?? process.cwd()) {
  return (await faeStatements(root)) < ROWS;
}

// The built output the suite runs: a tree rebuilt by the published transpiler
// and then relinked to the fork passes the probe and still counts per row.
export function outputBatched(files) {
  return files.every((f) => BLOCK.test(readFileSync(f, "utf8")));
}

// For mocha: `before(async function () { await requireBatchedFae(this); })`.
// It fails, it does not skip: a skip is green, and a CI that has the
// published packages must not be green on a test it never ran.
//   files: the built modules the suite executes (output/...mjs)
export async function requireBatchedFae(context, files = [], probe = batchesFae) {
  if (context?.timeout) context.timeout(Math.max(context.timeout(), 60000));
  if (await probe() !== true) {
    throw new Error(RELINK);
  }
  if (outputBatched(files) !== true) {
    throw new Error(STALE);
  }
}

// the runtime's module-level sy, reached before an ABAP is constructed
// (the instance only exposes it afterwards)
export function syOf(root = process.cwd()) {
  const need = createRequire(join(root, "package.json"));
  return need(join(dirname(need.resolve("@abaplint/runtime/package.json")), "build", "src", "builtin")).sy;
}
