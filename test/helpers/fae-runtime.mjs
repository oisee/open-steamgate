// Does the tree under test batch FOR ALL ENTRIES?
//
// ANOMALY-2026-09-30-fae-one-select-per-row: the published transpiler writes
// one SELECT per row of the driving table, and the pinned fork
// (libs.lock.json, linked by tools/osd-link.mjs) writes one per block of 50.
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
import {createRequire} from "node:module";
import {join} from "node:path";
import {modulesOf} from "../../tools/osd-transpile.mjs";

const ROWS = 120;

export const RELINK = "relink the pinned runtime (published @abaplint/runtime runs FOR ALL ENTRIES per row): TRANSPILER=<fork> node tools/osd-link.mjs runtime packages/runtime";

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

  const runtime = createRequire(join(root, "package.json"))("@abaplint/runtime");
  const abap = new runtime.ABAP();
  let calls = 0;
  abap.statements.select = async () => { calls++; };
  // the runtime reaches for a global `abap`; borrow it and give it back, the
  // suite that asked may have its own
  const had = Object.getOwnPropertyDescriptor(globalThis, "abap");
  globalThis.abap = abap;
  try {
    const run = Object.getPrototypeOf(async function () {}).constructor;
    await new run("abap", code)(abap);
  } finally {
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

// For mocha: `before(async function () { await requireBatchedFae(this); })`.
// It fails, it does not skip: a skip is green, and a CI that has the
// published packages must not be green on a test it never ran.
export async function requireBatchedFae(context, probe = batchesFae) {
  if (context?.timeout) context.timeout(Math.max(context.timeout(), 60000));
  if (await probe() !== true) {
    throw new Error(RELINK);
  }
}
