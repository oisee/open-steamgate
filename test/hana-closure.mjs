import {expect} from "chai";
import {appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {fileURLToPath} from "node:url";
import {classifyFindings, dumperCommand, islandBasenames, parseEnvFile, parseFindings, requestFor, run, tadirKinds} from "../tools/hana-closure.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

// H5c: the dependency closure, by iteration (tools/hana-closure.mjs).
//
// Everything here runs against fakes, the way CI must: the dumper is a
// fixture script this test writes that mimics the real binary's CLI contract
// (a foreign binary on the bed, spawned by path from OSD_HANA_DUMPER: the
// required connection flags, the schema-1 request file, the refusal of an
// --out inside a git working tree unless --allow-in-repo, the password read
// from VSP_HANA_PASSWORD only), the dump merge is a fake host behind
// OSD_SELF (the real hana-ddic-gen --from-dump and hana-src-gen --from-dump
// arrive with PR #926; the loop only owns their argv), and the validate step
// is the transpiler's own validation over a scratch tree whose node_modules
// is a symlink to this checkout's. No HANA is reachable from CI. Names are
// ZOSD_H5C_* fixtures; a real service's names live in the private findings
// log and its leak list.
describe("hana-closure: the dependency closure, by iteration", () => {

  // ------------------------------------------------------------- units ----

  it("classifies every message shape the transpiler emits", () => {
    const lines = [
      // names the request asks the dumper for
      `check_syntax, Database table or view "zosd_h5c_bpa" not found, zcl_h5c_app.clas.abap:10`,
      `unknown_types, Variable "LV_ROLE" contains unknown: ZOSD_H5C_ROLE not found, lookup, zcl_h5c_app.clas.abap:11`,
      `unknown_types, Variable "LV_ID" contains unknown: ZOSD_H5C_ID not found, lookupDataElement, zcl_h5c_app.clas.abap:12`,
      `unknown_types, Variable "LV_GUID" contains unknown: ZOSD_H5C_UUID, lookupDomain, zcl_h5c_app.clas.abap:13`,
      `unknown_types, Contains unknown, ZOSD_H5C_LAND not found, lookup, zcl_h5c_app.clas.abap:14`,
      `check_syntax, Class zcl_h5c_facade not found, zcl_h5c_app.clas.abap:15`,
      `check_syntax, Unknown class cl_h5c_standard, zcl_h5c_app.clas.abap:16`,
      `check_syntax, Unknown class if_h5c_bo, zcl_h5c_app.clas.abap:17`,
      `check_syntax, CATCH, unknown class ZCX_H5C_API, zcl_h5c_app.clas.abap:18`,
      `unknown_types, Could not resolve top IF_H5C_MSG, resolveTypeChain, zcl_h5c_app.clas.abap:19`,
      `unknown_types, Variable "LT_BUF" could not resolve top IF_H5C_BO, resolveTypeChain, zcl_h5c_app.clas.abap:20`,
      `check_syntax, Loop, not a table type, Could not resolve top IF_H5C_MSG, resolveTypeChain, zcl_h5c_app.clas.abap:21`,
      `unknown_types, Variable "LR_BUF" contains unknown: REF, unable to resolve if_h5c_msg, zcl_h5c_app.clas.abap:22`,
      `parser_error, Statement does not exist in the configured ABAP version(or a parser error), "FUNCTION", #zosd#gws_h5c_shexits.fugr.#zosd#lgws_h5c$01.abap:5`,
      `unknown_types, Variable "LR_TXT" contains unknown: Type error, field not part of structure zosd_h5c_v-ddtext, zcl_h5c_app.clas.abap:23`,
      `unknown_types, ZOSD_H5C_PARAMS_TAB not found, lookup, zcl_h5c_app.clas.abap:24`,
      `check_syntax, Loop, not a table type, /ZOSD/H5C_T_NAVI not found, lookup, zcl_h5c_app.clas.abap:25`,
      // cascades: the named thing is not the thing that is missing
      `check_syntax, Method or attribute "retrieve" not found, MethodSource, zcl_h5c_app.clas.abap:24`,
      `check_syntax, Method "get_messages" not found, methodCallChain, zcl_h5c_app.clas.abap:25`,
      `check_syntax, Component "content_id" not found in structure, zcl_h5c_app.clas.abap:26`,
      `check_syntax, Not an object reference, attribute name, zcl_h5c_app.clas.abap:27`,
      `check_syntax, Not an object reference, field chain, zcl_h5c_app.clas.abap:28`,
      `unknown_types, Variable "LS_P" contains unknown: Type error, not a table type mt_h5c_params, zcl_h5c_app.clas.abap:29`,
      `unknown_types, Variable "LS_C" contains unknown: TY_S_H5C_CHANGESET not found in class or interface, zcl_h5c_app.clas.abap:30`,
      `unknown_types, Variable "LS_H5C_HEAD" contains unknown: Select, buildStructureTypeError not found, zcl_h5c_app.clas.abap:31`,
      `check_syntax, "callcontrol" not found, findTop, #zosd#gws_h5c_shexits.fugr.#zosd#gws_h5c_exit.abap:31`,
      `check_syntax, "record_tab" not found, Target, #zosd#gws_h5c_shexits.fugr.#zosd#gws_h5c_exit.abap:32`,
      // not findings at all
      `osd-build: transpile`,
      ``,
    ];
    const {names, cascades, unclassified} = classifyFindings(parseFindings(lines.join("\n")));
    const want = [
      ["ZOSD_H5C_BPA", "tabl"],
      ["ZOSD_H5C_ROLE", "ddic"],
      ["ZOSD_H5C_ID", "dtel"],
      ["ZOSD_H5C_UUID", "doma"],
      ["ZOSD_H5C_LAND", "ddic"],
      ["ZCL_H5C_FACADE", "clas"],
      ["CL_H5C_STANDARD", "clas"],
      ["IF_H5C_BO", "intf"],
      ["ZCX_H5C_API", "clas"],
      ["IF_H5C_MSG", "intf"],
      ["/ZOSD/GWS_H5C_SHEXITS", "fugr"],
      ["ZOSD_H5C_V", "tabl"],
      ["ZOSD_H5C_PARAMS_TAB", "ddic"],
      ["/ZOSD/H5C_T_NAVI", "ddic"],
    ];
    expect(names.map((n) => [n.name, n.kind]), "every name, classified, in first-named order").to.deep.equal(want);
    // the first finding that named it rides along -- the gaps file quotes it
    expect(names[0].finding).to.include(`Database table or view "zosd_h5c_bpa" not found`);
    expect(names[10].finding).to.include(`#zosd#gws_h5c_shexits.fugr.`);
    expect(cascades, "the cascade findings are counted, not named").to.equal(10);
    expect(unclassified, "every line was understood").to.deep.equal([]);
  });

  it("a repeated name is asked once, with its first finding", () => {
    const line = `check_syntax, Database table or view "zosd_h5c_bpa" not found, zcl_h5c_app.clas.abap:10`;
    const {names, cascades} = classifyFindings(parseFindings([line, line, line].join("\n")));
    expect(names).to.have.lengthOf(1);
    expect(names[0].finding).to.equal(line);
    expect(cascades, "a repeated name is the same name, not a cascade").to.equal(0);
  });

  it("tolerates the build log's FAILED prefix and reports what it cannot classify", () => {
    const {names, unclassified} = classifyFindings(parseFindings([
      `osd-build: FAILED: unknown_types, Contains unknown, ZOSD_H5C_LAND not found, lookup, zcl_h5c_app.clas.abap:14`,
      `check_datasets, Open ABAP Cloud shapes only, zcl_h5c_ref.clas.abap:3`,
    ].join("\n")));
    expect(names.map((n) => n.name)).to.deep.equal(["ZOSD_H5C_LAND"]);
    expect(unclassified).to.deep.equal([`check_datasets, Open ABAP Cloud shapes only, zcl_h5c_ref.clas.abap:3`]);
  });

  it("a kind-less ddic name is asked under TABL, DTEL and TTYP -- SHLP only when the finding says search help", () => {
    // `contains unknown: X not found` does not say whether X is a table, a
    // data element or a table type: the name goes in under every kind the
    // dumper resolves by name, and the dumper's manifest.closure reports
    // what the dictionary does not have
    expect(tadirKinds("ddic", `unknown_types, Variable "LV_ROLE" contains unknown: ZOSD_H5C_ROLE not found, lookup, zcl_h5c_app.clas.abap:11`))
      .to.deep.equal(["TABL", "DTEL", "TTYP"]);
    expect(tadirKinds("ddic", `check_syntax, "callcontrol" not found, findTop, #zosd#gws_h5c_shexits.fugr.x.abap:31 -- the search help exit's TABLES signature`))
      .to.deep.equal(["TABL", "DTEL", "TTYP", "SHLP"]);
    expect(tadirKinds("tabl", "f")).to.deep.equal(["TABL"]);
    expect(tadirKinds("dtel", "f")).to.deep.equal(["DTEL"]);
    expect(tadirKinds("doma", "f")).to.deep.equal(["DOMA"]);
    expect(tadirKinds("clas", "f")).to.deep.equal(["CLAS"]);
    expect(tadirKinds("intf", "f")).to.deep.equal(["INTF"]);
    expect(tadirKinds("fugr", "f")).to.deep.equal(["FUGR"]);
  });

  it("the request is schema 1, exactly what the dumper's reader reads", () => {
    const kinds = ["TABL", "DTEL", "DOMA", "TTYP", "SHLP", "CLAS", "INTF", "FUGR", "PROG"];
    const asked = {ZOSD_H5C_ROLE: {kinds: ["TABL", "DTEL", "TTYP"], iteration: 2, finding: "old finding"}};
    const gaps = [{name: "ZOSD_H5C_UUID", kind: "DOMA", first_finding: "f", iterations_requested: 3}];
    const fresh = [
      {name: "ZOSD_H5C_BPA", kind: "tabl", finding: "f"},
      {name: "IF_H5C_BO", kind: "intf", finding: "g"},
      {name: "ZOSD_H5C_SHLP_EXIT", kind: "ddic", finding: `"callcontrol" not found -- the search help exit's TABLES signature`},
    ];
    const request = requestFor({iteration: 3, generation: "h5c_sha", fresh, asked, gaps});
    expect(Object.keys(request).sort(), "the exact key set").to.deep.equal(
      ["gaps", "generation", "iteration", "requested", "schema", "seen", "source"]);
    expect(request.schema, "the reader refuses any other schema").to.equal(1);
    expect(request.iteration).to.equal(3);
    expect(request.generation, "the hash from the merge's manifest").to.equal("h5c_sha");
    expect(request.source).to.equal("transpile validate() findings");
    expect(Object.keys(request.requested), "the nine upper-case TADIR kinds").to.deep.equal(kinds);
    expect(Object.keys(request.seen)).to.deep.equal(kinds);
    expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_BPA", "ZOSD_H5C_SHLP_EXIT"]);
    expect(request.requested.DTEL).to.deep.equal(["ZOSD_H5C_SHLP_EXIT"]);
    expect(request.requested.TTYP).to.deep.equal(["ZOSD_H5C_SHLP_EXIT"]);
    expect(request.requested.SHLP).to.deep.equal(["ZOSD_H5C_SHLP_EXIT"]);
    expect(request.requested.INTF).to.deep.equal(["IF_H5C_BO"]);
    expect(request.requested.CLAS).to.deep.equal([]);
    // seen is what earlier iterations requested, per kind, so the dumper skips it
    expect(request.seen.TABL).to.deep.equal(["ZOSD_H5C_ROLE"]);
    expect(request.seen.DTEL).to.deep.equal(["ZOSD_H5C_ROLE"]);
    expect(request.seen.TTYP).to.deep.equal(["ZOSD_H5C_ROLE"]);
    expect(request.seen.PROG).to.deep.equal([]);
    expect(request.gaps).to.deep.equal([{name: "ZOSD_H5C_UUID", kind: "DOMA", first_finding: "f", iterations_requested: 3}]);
  });

  it("the dumper's argv is the real binary's contract, and the password stays out of it", () => {
    const connection = {HANA_HOST: "h5c.example", HANA_PORT: "30215", HANA_USER: "h5c_user", HANA_SCHEMA: "h5c_schema", HANA_PASSWORD: "h5c_secret"};
    const {argv, env} = dumperCommand({dumper: "/opt/vsp/vsp-hana", connection, requestPath: "/r/closure-request.json", dumpDir: "/d/dump-002", provenance: "closure iteration 2"});
    expect(argv.slice(0, 3)).to.deep.equal(["/opt/vsp/vsp-hana", "hana", "dump"]);
    const flag = (name) => argv[argv.indexOf(name) + 1];
    expect(flag("--host")).to.equal("h5c.example");
    expect(flag("--port")).to.equal("30215");
    expect(flag("--user")).to.equal("h5c_user");
    expect(flag("--schema")).to.equal("h5c_schema");
    expect(flag("--provenance")).to.equal("closure iteration 2");
    expect(flag("--ddic-closure"), "the request file, not a comma-joined --name").to.equal("/r/closure-request.json");
    expect(flag("--out")).to.equal("/d/dump-002");
    expect(argv, "the dump lands in gitignored .local/, which the dumper refuses without the flag").to.include("--allow-in-repo");
    expect(argv.join(" "), "the password is in the child's environment only, never on the argv").to.not.include("h5c_secret");
    expect(argv).to.not.include("--name");
    expect(argv).to.not.include("--password");
    expect(env).to.deep.equal({VSP_HANA_PASSWORD: "h5c_secret"});
    try {
      dumperCommand({dumper: "/opt/vsp/vsp-hana", connection: {...connection, HANA_HOST: ""}, requestPath: "/r", dumpDir: "/d", provenance: "p"});
      expect.fail("a connection without the host was accepted");
    } catch (error) {
      expect(error.message).to.match(/HANA_HOST/);
    }
  });

  it("reads the dumper's connection env file", () => {
    expect(parseEnvFile([
      "# the connection",
      "HANA_HOST=h5c.example",
      "",
      "export HANA_USER=h5c_user",
      "HANA_PASSWORD=h5c_secret",
    ].join("\n"))).to.deep.equal({HANA_HOST: "h5c.example", HANA_USER: "h5c_user", HANA_PASSWORD: "h5c_secret"});
  });

  it("the island's basenames come out of gen/hana-src/** and gen/hana-ddic/*, never out of src/", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-closure-island-"));
    try {
      mkdirSync(join(root, "gen", "hana-src", "001-h5c", "src"), {recursive: true});
      mkdirSync(join(root, "gen", "hana-ddic"), {recursive: true});
      mkdirSync(join(root, "src"), {recursive: true});
      writeFileSync(join(root, "gen", "hana-src", "001-h5c", "src", "zcl_h5c_island.clas.abap"), "x");
      writeFileSync(join(root, "gen", "hana-src", "001-h5c", "src", "sub.clas.abap"), "x");
      writeFileSync(join(root, "gen", "hana-ddic", "zosd_h5c_head.tabl.xml"), "x");
      writeFileSync(join(root, "src", "zcl_h5c_own.clas.abap"), "x");
      const island = islandBasenames(root);
      expect([...island].sort(), "the island's files, nested layers included").to.deep.equal(
        ["sub.clas.abap", "zcl_h5c_island.clas.abap", "zosd_h5c_head.tabl.xml"]);
      expect(island.has("zcl_h5c_own.clas.abap"), "a src/ file is the tree's own").to.equal(false);
      expect(islandBasenames(join(root, "nowhere")).size, "no island, no names").to.equal(0);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  // ------------------------------------------------------------- loop -----

  // the fixture class: one SELECT against a table the scratch tree does not
  // have -- the one shape a first closure iteration is made of
  const CLAS_SOURCE = [
    `CLASS zcl_h5c_loop DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    METHODS run_it.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_loop IMPLEMENTATION.`,
    `  METHOD run_it.`,
    `    SELECT SINGLE * FROM zosd_h5c_head INTO @DATA(ls_h5c_head) ##SUBRC_OK.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  // and one whose class types by an unknown name -- the wording that carries
  // no dictionary kind (the `ddic` bucket)
  const CLAS_TYPE_SOURCE = [
    `CLASS zcl_h5c_type DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    METHODS run_it.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_type IMPLEMENTATION.`,
    `  METHOD run_it.`,
    `    DATA lv_w TYPE zosd_h5c_w.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  // the tree's own business: a class under src/ naming its own table. Its
  // finding is real, but it is outside the island -- src/ findings are never
  // asked (the request must not carry ZOSD_H5C_OWN anywhere)
  const OWN_SOURCE = [
    `CLASS zcl_h5c_own DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    METHODS run_it.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_own IMPLEMENTATION.`,
    `  METHOD run_it.`,
    `    SELECT SINGLE * FROM zosd_h5c_own INTO @DATA(ls_h5c_own) ##SUBRC_OK.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  // a scratch tree that validates like the real one, at fixture scale: the
  // same input-folder shape (the generated DDIC first, the tenant sources,
  // then src), no libraries, and this checkout's transpiler through a
  // symlinked node_modules. The loop's fixture class is staged OUTSIDE every
  // input folder; the fake host lays it into gen/hana-src/001-h5c/src/ on
  // each source merge, the way the real hana-src-gen --from-dump lays the
  // dumped sources -- so the mixed validate() output names files of the
  // island and of src/, and only the island's are classified.
  const scratch = (source = CLAS_SOURCE, name = "zcl_h5c_loop") => {
    const root = mkdtempSync(join(tmpdir(), "hana-closure-root-"));
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "package.json"), JSON.stringify({name: "hana-closure-scratch", private: true}) + "\n");
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({
      input_folder: ["gen/hana-ddic", "gen/hana-src/*", "src"],
      output_folder: "output",
      libs: [],
      write_source_map: false,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"},
    }, null, 2) + "\n");
    mkdirSync(join(root, "src"), {recursive: true});
    writeFileSync(join(root, "src", "zcl_h5c_own.clas.abap"), OWN_SOURCE);
    mkdirSync(join(root, "island"), {recursive: true});
    writeFileSync(join(root, "island", `${name}.clas.abap`), source);
    return root;
  };

  // iteration 1's dump: a dump directory of --ddic shape, carrying nothing
  // the fixture tree needs yet -- or, when `tables` is given, exactly those
  // DD02L rows
  const fixtureDump = (dir, tables = []) => {
    mkdirSync(join(dir, "tables"), {recursive: true});
    writeFileSync(join(dir, "tables", "DD02L.jsonl"), tables.map((t) => JSON.stringify({TABNAME: t})).join("\n") + (tables.length === 0 ? "" : "\n"));
    writeFileSync(join(dir, "manifest.json"), "{}\n");
  };

  // the fake dumper: the real binary's CLI contract (required flags, the
  // schema-1 request file, the git-tree refusal unless --allow-in-repo, the
  // password from VSP_HANA_PASSWORD only), a synthetic --ddic dump, and a
  // record of what it saw. H5C_MISSING_KINDS names the dictionary kinds the
  // "dictionary" lacks; by default every requested name resolves.
  const fakeDumperSource = () => `#!/usr/bin/env node
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] !== "hana" || args[1] !== "dump") process.exit(3);
// the flags the real binary refuses to run without (MarkFlagRequired)
for (const flag of ["--host", "--user", "--schema", "--provenance", "--out"]) {
  if (at(flag) === undefined || at(flag) === "") {
    console.error("required flag(s) not set: " + flag.slice(2));
    process.exit(3);
  }
}
// an --out inside a git working tree is refused unless --allow-in-repo
const out = resolve(at("--out"));
for (let dir = out; ; dir = dirname(dir)) {
  if (existsSync(join(dir, ".git"))) {
    if (args.includes("--allow-in-repo") === false) {
      console.error("dumps stay out of repositories");
      process.exit(3);
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
}
// the request is read the way the real reader reads it: schema 1
const request = JSON.parse(readFileSync(at("--ddic-closure"), "utf8"));
if (request.schema !== 1) {
  console.error("schema " + request.schema + ", expected 1");
  process.exit(3);
}
const record = process.env.H5C_RECORD;
if (record) appendFileSync(record, JSON.stringify({
  argv: args,
  out,
  ddicClosure: at("--ddic-closure"),
  allowInRepo: args.includes("--allow-in-repo"),
  provenance: at("--provenance"),
  connection: {host: at("--host"), port: at("--port"), user: at("--user"), schema: at("--schema")},
  passwordEnv: process.env.VSP_HANA_PASSWORD ?? null,
}) + "\\n");
// what the dictionary answered: the request's dictionary names, resolved
// unless H5C_MISSING_KINDS says the dictionary lacks the kind
const missingKinds = (process.env.H5C_MISSING_KINDS ?? "").split(",").filter(Boolean);
const resolved = {};
const missing = {};
for (const kind of ["TABL", "DTEL", "DOMA", "TTYP", "SHLP"]) {
  const list = request.requested[kind] ?? [];
  if (list.length === 0) continue;
  (missingKinds.includes(kind) ? missing : resolved)[kind] = [...list].sort();
}
const found = missingKinds.includes("TABL") ? [] : (request.requested.TABL ?? []);
mkdirSync(join(out, "tables"), {recursive: true});
writeFileSync(join(out, "tables", "DD02L.jsonl"), found.map((t) => JSON.stringify({TABNAME: t.toUpperCase()})).join("\\n") + (found.length === 0 ? "" : "\\n"));
writeFileSync(join(out, "manifest.json"), JSON.stringify({closure: {rounds: 1, resolved, missing}}) + "\\n");
process.exit(0);
`;

  // the fake host behind OSD_SELF: the argv of hana-ddic-gen --from-dump and
  // hana-src-gen --from-dump is what the loop owns (the real tools arrive
  // with PR #926), so the fake asserts it and emulates the merge. The DDIC
  // half writes the same XML the real mapper writes -- it has to, the
  // transpiler must resolve it for the fixed point. With H5C_GROW=1 the
  // second source merge drops one more unresolved table into the tree, so
  // the closure keeps growing and a cap has something to stop.
  const fakeHostSource = () => `#!/usr/bin/env node
import {appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import {ddicFields, tablXml} from ${JSON.stringify(join(REPO, "tools", "hana-ddic-map.mjs"))};
const args = process.argv.slice(2);
const tool = args[1];
const rest = args.slice(2);
const at = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const log = process.env.H5C_HOST_LOG;
if (log) appendFileSync(log, JSON.stringify({tool, rest}) + "\\n");
if (process.env.H5C_NO_FROM_DUMP === "1" && tool === "hana-ddic-gen.mjs") {
  console.error("hana-ddic-gen: unknown option --from-dump");
  process.exit(2);
}
if (tool === "hana-ddic-gen.mjs") {
  const dump = at("--from-dump");
  const out = at("--out");
  let rows = [];
  try {
    rows = readFileSync(join(dump, "tables", "DD02L.jsonl"), "utf8").split("\\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  } catch { /* not a dump of --ddic shape: nothing to merge */ }
  // the real hana-ddic-map's TABCLASS refusal (H5a's guard, CRITIC-926):
  // the tool exits 2 on the first object it refuses to write
  const refuse = process.env.H5C_REFUSE;
  if (refuse !== undefined && rows.some((r) => String(r.TABNAME).toUpperCase() === refuse)) {
    console.error("hana-ddic-gen: hana-ddic-map: " + refuse + ": TABCLASS APPEND is not written here -- only TRANSP and INTTAB are");
    process.exit(2);
  }
  mkdirSync(out, {recursive: true});
  for (const row of rows) {
    const name = String(row.TABNAME).toUpperCase();
    const fields = ddicFields([{position: "1", fieldname: "ZOSD_H5C_KEY", keyflag: "X", rollname: "", datatype: "CHAR", leng: "10", decimals: "0", inttype: "C", intlen: "000020", notnull: "X"}]);
    writeFileSync(join(out, name.toLowerCase() + ".tabl.xml"), tablXml({name, text: "h5c fixture", clidep: false, fields}));
  }
  process.exit(0);
}
if (tool === "hana-src-gen.mjs") {
  const out = at("--out");
  mkdirSync(out, {recursive: true});
  writeFileSync(join(out, "manifest.json"), JSON.stringify({dump: {manifest_sha256: "h5c_sha"}}) + "\\n");
  // the merge lays the dumped sources: here, the staged fixture class into
  // an island layer, so its findings' file is under gen/hana-src/**
  const island = process.env.H5C_ISLAND_SRC;
  if (island !== undefined && island !== "") {
    const layer = join(out, "001-h5c", "src");
    mkdirSync(layer, {recursive: true});
    copyFileSync(island, join(layer, basename(island)));
  }
  if (process.env.H5C_GROW === "1") {
    const counter = join(out, "..", "host-invocations");
    const seen = (() => { try { return Number(readFileSync(counter, "utf8")); } catch { return 0; } })();
    writeFileSync(counter, String(seen + 1));
    if (seen >= 1) {
      const layer = join(out, "001-more", "src");
      mkdirSync(layer, {recursive: true});
      writeFileSync(join(layer, "zcl_h5c_more.clas.abap"), [
        "CLASS zcl_h5c_more DEFINITION PUBLIC FINAL CREATE PUBLIC.",
        "  PUBLIC SECTION.",
        "    METHODS run_it.",
        "ENDCLASS.",
        "CLASS zcl_h5c_more IMPLEMENTATION.",
        "  METHOD run_it.",
        "    SELECT SINGLE * FROM zosd_h5c_more_2 INTO @DATA(ls_h5c_more) ##SUBRC_OK.",
        "  ENDMETHOD.",
        "ENDCLASS.",
        "",
      ].join("\\n"));
    }
  }
  process.exit(0);
}
process.exit(2);
`;

  const envFor = (root, opts = {}) => ({
    ...process.env,
    OSD_SELF: JSON.stringify([process.execPath, join(root, "fake-host.mjs")]),
    H5C_HOST_LOG: join(root, "host-log.jsonl"),
    H5C_ISLAND_SRC: join(root, "island", opts.island ?? "zcl_h5c_loop.clas.abap"),
    ...(opts.grow ? {H5C_GROW: "1"} : {}),
    ...(opts.noFromDump ? {H5C_NO_FROM_DUMP: "1"} : {}),
    ...(opts.missingKinds !== undefined ? {H5C_MISSING_KINDS: opts.missingKinds} : {}),
    ...(opts.refuse !== undefined ? {H5C_REFUSE: opts.refuse} : {}),
    ...(opts.dumper === false ? {OSD_HANA_DUMP_ENV: join(root, "dump.env")} : {
      OSD_HANA_DUMPER: join(root, "fake-dumper.mjs"),
      OSD_HANA_DUMP_ENV: join(root, "dump.env"),
      H5C_RECORD: join(root, "dumper-log.jsonl"),
    }),
  });

  const writeFakes = (root, env) => {
    writeFileSync(join(root, "fake-host.mjs"), fakeHostSource());
    writeFileSync(join(root, "fake-dumper.mjs"), fakeDumperSource());
    chmodSync(join(root, "fake-dumper.mjs"), 0o755);
    writeFileSync(join(root, "dump.env"), [
      "# the bed connection",
      "HANA_HOST=h5c.example",
      "HANA_PORT=30215",
      "HANA_USER=h5c_user",
      "HANA_SCHEMA=h5c_schema",
      "HANA_PASSWORD=h5c_secret",
      "",
    ].join("\n"));
    return env;
  };

  const dumperCalls = (root) => readFileSync(join(root, "dumper-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const hostCalls = (root) => readFileSync(join(root, "host-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const outFile = (root, name) => join(root, "gen", "hana-closure", name);
  const dumpDirOf = (root, n) => join(root, ".local", "hana-closure", `dump-${String(n).padStart(3, "0")}`);

  it("runs to the fixed point: ask, dump through the fake, merge, and the name resolves", async function () {
    this.timeout(180000);
    const root = scratch();
    // the dumps land inside the tree (gitignored .local/): the fake dumper
    // refuses that without --allow-in-repo, the way the real one does
    mkdirSync(join(root, ".git"));
    const dump = join(root, "dump-001");
    fixtureDump(dump);
    const env = writeFakes(root, envFor(root));
    const said = [];
    try {
      const result = await run(["--dump", dump, "--system", "h5c"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      expect(result.iteration).to.equal(2);

      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(Object.keys(request).sort()).to.deep.equal(
        ["gaps", "generation", "iteration", "requested", "schema", "seen", "source"]);
      expect(request.schema).to.equal(1);
      expect(request.iteration).to.equal(2);
      expect(request.generation, "the hash the merge's manifest carries").to.equal("h5c_sha");
      expect(request.source).to.equal("transpile validate() findings");
      // the mixed validate() output named ZOSD_H5C_HEAD (the island fixture)
      // AND ZOSD_H5C_OWN (src/, the tree's own): only the island's is asked
      expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(JSON.stringify(request), "a src/ finding never enters the request").to.not.include("ZOSD_H5C_OWN");
      expect(request.seen.TABL).to.deep.equal([]);
      expect(request.gaps).to.deep.equal([]);

      // the island scoping is reported once per iteration, as a count (the
      // src/ class emits its findings -- the tree's own, counted, not named)
      expect(said.some((l) => /iteration 1: 1 new name\(s\), 0 gap\(s\), [1-9][0-9]* outside the island/.test(l)),
        "the unscoped count is on the iteration line").to.equal(true);
      // the loop's own dump line prints --host <env>, never the values
      // (logs get pasted); the by-hand command keeps them
      expect(said.some((l) => /^dump: hana dump --host <env> --port <env> --user <env> --schema <env> /.test(l)),
        "the dumper's log line is redacted").to.equal(true);
      for (const secret of ["h5c.example", "30215", "h5c_user", "h5c_schema", "h5c_secret"]) {
        expect(said.some((l) => l.includes(secret)), `${secret} stays off the loop's log`).to.equal(false);
      }

      // the fake dumper saw the whole contract: subcommand, the request file,
      // its own directory inside .local/, the provenance, the connection
      // flags of the env file -- and the password only in its environment
      const calls = dumperCalls(root);
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].argv.slice(0, 2)).to.deep.equal(["hana", "dump"]);
      expect(calls[0].ddicClosure).to.equal(join(root, "gen", "hana-closure", "closure-request.json"));
      expect(calls[0].allowInRepo, "the dump is inside the tree, the flag must travel").to.equal(true);
      expect(calls[0].out).to.equal(dumpDirOf(root, 2));
      expect(calls[0].provenance).to.match(/iteration 2/);
      expect(calls[0].connection).to.deep.equal({host: "h5c.example", port: "30215", user: "h5c_user", schema: "h5c_schema"});
      expect(calls[0].passwordEnv).to.equal("h5c_secret");
      expect(calls[0].argv.join(" "), "no env-file value on the spawned argv").to.not.include("h5c_secret");
      expect(calls[0].argv.join(" ")).to.not.include("--name");

      // both merges ran through the host dispatch, twice (two passes)
      const merges = hostCalls(root);
      expect(merges.map((m) => m.tool)).to.deep.equal(
        ["hana-ddic-gen.mjs", "hana-src-gen.mjs", "hana-ddic-gen.mjs", "hana-src-gen.mjs"]);
      expect(merges[0].rest).to.deep.equal(["--from-dump", dump, "--out", join(root, "gen", "hana-ddic")]);
      expect(merges[1].rest).to.deep.equal(
        ["--from-dump", "--dump", dump, "--system", "h5c", "--out", join(root, "gen", "hana-src")]);
      expect(merges[2].rest[1], "the second pass merges the dump the dumper wrote").to.equal(dumpDirOf(root, 2));

      // resolved, so: no gaps, no third round
      expect(JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps).to.deep.equal([]);
      expect(existsSync(dumpDirOf(root, 3))).to.equal(false);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.iteration).to.equal(2);
      expect(state.dump).to.equal(dumpDirOf(root, 2));
      expect(state.pending, "the round was answered in-run").to.equal(undefined);
      expect(state.asked.ZOSD_H5C_HEAD.kinds).to.deep.equal(["TABL"]);
      expect(state.asked.ZOSD_H5C_HEAD.iteration).to.equal(2);
      expect(state.asked.ZOSD_H5C_HEAD.finding).to.match(/Database table or view "zosd_h5c_head" not found/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a kind-less ddic name the dictionary HAS (resolved under one of the three kinds) is not a gap", async function () {
    this.timeout(180000);
    // the dictionary answers per kind: resolved under TABL, "missing" under
    // DTEL and TTYP -- that is the normal answer for a name it has, not a
    // gap (the gap rule is asked AND still unresolved after the dump)
    const root = scratch(CLAS_TYPE_SOURCE, "zcl_h5c_type");
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_type.clas.abap", missingKinds: "DTEL"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");

      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.requested.TABL, "the kind-less name under every kind the dumper resolves").to.deep.equal(["ZOSD_H5C_W"]);
      expect(request.requested.DTEL).to.deep.equal(["ZOSD_H5C_W"]);
      expect(request.requested.TTYP).to.deep.equal(["ZOSD_H5C_W"]);
      expect(request.requested.SHLP, "the finding says nothing of search helps").to.deep.equal([]);

      // TABL resolved, the merge wrote the table, the build knows the name:
      // no gap, whatever the other two kinds' missing answer said
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps, "resolved under TABL is the dictionary HAS the name").to.deep.equal([]);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.missing).to.deep.equal({});
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a kind-less ddic name the dictionary lacks under every kind it was asked is a gap", async function () {
    this.timeout(180000);
    const root = scratch(CLAS_TYPE_SOURCE, "zcl_h5c_type");
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_type.clas.abap", missingKinds: "TABL,DTEL,TTYP"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      // asked, and the dump answered "missing" under all three kinds: the
      // dictionary does not have the name, the gap stands -- under one of
      // the kinds it was asked under (which one the per-kind answer names)
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_W");
      expect(["TABL", "DTEL", "TTYP"], "the kind of the per-kind missing answer").to.include(gaps[0].kind);
      expect(gaps[0].first_finding).to.match(/contains unknown: ZOSD_H5C_W not found/);
      expect(gaps[0].iterations_requested).to.equal(2);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(Object.keys(state.missing)).to.deep.equal(["ZOSD_H5C_W"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a name the dumper answered but the build still misses is a gap with its kind and first finding", async function () {
    this.timeout(180000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {missingKinds: "TABL"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_HEAD");
      expect(gaps[0].kind).to.equal("TABL");
      expect(gaps[0].first_finding).to.match(/Database table or view "zosd_h5c_head" not found/);
      expect(gaps[0].iterations_requested).to.equal(2);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a merge tool's refusal of one object is a gap, and the merge continues without it", async function () {
    this.timeout(180000);
    // bedrun3's live death: hana-ddic-map refuses a TABCLASS APPEND structure
    // and hana-ddic-gen exits 2 -- the loop must not die on it
    const root = scratch();
    fixtureDump(join(root, "dump-001"), ["ZOSD_H5C_APPEND", "ZOSD_H5C_KEEP"]);
    const env = writeFakes(root, envFor(root, {refuse: "ZOSD_H5C_APPEND"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped, "the refusal did not stop the loop").to.equal("fixed-point");

      // the object is a gap: the dictionary HAS it, the generator refuses it
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_APPEND");
      expect(gaps[0].kind).to.equal("TABL");
      expect(gaps[0].reason).to.equal("unsupported TABCLASS APPEND");
      expect(gaps[0].first_finding).to.match(/TABCLASS APPEND is not written here/);
      expect(gaps[0].iterations_requested, "never asked: asking cannot source it").to.equal(undefined);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.refused.ZOSD_H5C_APPEND.reason).to.equal("unsupported TABCLASS APPEND");

      // the merge went on: a retry against a filtered copy of the dump --
      // the refused row gone, the dump's own remaining rows kept -- and the
      // loop's own dump is still the original
      const ddicMerges = hostCalls(root).filter((m) => m.tool === "hana-ddic-gen.mjs");
      expect(ddicMerges[0].rest[1]).to.equal(join(root, "dump-001"));
      const retryDump = ddicMerges[1].rest[1];
      expect(retryDump, "the retry reads a filtered copy, not the dump itself").to.not.equal(join(root, "dump-001"));
      const kept = readFileSync(join(retryDump, "tables", "DD02L.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      expect(kept.map((r) => r.TABNAME)).to.deep.equal(["ZOSD_H5C_KEEP"]);
      expect(existsSync(join(root, "gen", "hana-ddic", "zosd_h5c_keep.tabl.xml")), "the rest of the dump merged").to.equal(true);
      expect(existsSync(join(root, "gen", "hana-ddic", "zosd_h5c_append.tabl.xml")), "the refused object is not written").to.equal(false);
      expect(existsSync(join(root, "dump-001", "tables", "DD02L.jsonl")), "the dump itself is untouched").to.equal(true);

      // the request does not carry the refused name -- asking is pointless
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(JSON.stringify(request)).to.not.include("ZOSD_H5C_APPEND");
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--dry-run writes the request -- and marks its names asked -- and never starts the dumper", async function () {
    this.timeout(180000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c", "--dry-run"], {root, env});
      expect(result.stopped).to.equal("dry-run");
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.schema).to.equal(1);
      expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(existsSync(join(root, "dumper-log.jsonl")), "the dumper was not spawned").to.equal(false);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.asked.ZOSD_H5C_HEAD.iteration, "the request's names are asked from the moment it is written").to.equal(2);
      expect(state.pending.dumpDir).to.equal(dumpDirOf(root, 2));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the manual route: the request marks its names asked, and a hand-run dump + --dump continuation gaps what is still missing", async function () {
    this.timeout(300000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const bare = writeFakes(root, envFor(root, {dumper: false}));
    const dumpDir = dumpDirOf(root, 2);
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env: bare});
      expect(result.stopped).to.equal("no-dumper");
      expect(result.command).to.include(`hana dump --host h5c.example --port 30215 --user h5c_user --schema h5c_schema`);
      expect(result.command).to.include(`--ddic-closure ${join(root, "gen", "hana-closure", "closure-request.json")}`);
      expect(result.command).to.include(`--out ${dumpDir}`);
      expect(result.command).to.include("--allow-in-repo");
      expect(result.command).to.include(`$OSD_HANA_DUMPER`);
      // the request was written; its names are asked; the round is pending
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.asked.ZOSD_H5C_HEAD.kinds).to.deep.equal(["TABL"]);
      expect(state.pending.dumpDir).to.equal(dumpDir);

      // a bare run without the dumper re-prints the pending round; it does
      // not merge, because the pending dump does not exist yet
      const before = hostCalls(root).length;
      const again = await run(["--system", "h5c"], {root, env: bare});
      expect(again.stopped).to.equal("no-dumper");
      expect(again.command).to.include(`--out ${dumpDir}`);
      expect(hostCalls(root).length, "no merge ran").to.equal(before);

      // the hand-run dump lands where the pending round pointed, and it
      // lacks the name: the continuation sees the name as asked and gaps it
      fixtureDump(dumpDir);
      const second = await run(["--system", "h5c", "--dump", dumpDir], {root, env: bare});
      expect(second.stopped, "asked and still unresolved: a gap").to.equal("fixed-point");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_HEAD");
      expect(gaps[0].kind).to.equal("TABL");
      expect(gaps[0].iterations_requested).to.equal(2);
      expect(existsSync(join(root, "dumper-log.jsonl")), "the dumper was never spawned").to.equal(false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--max-iterations stops with the pending request on disk, and the next run executes it", async function () {
    this.timeout(300000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {grow: true}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c", "--max-iterations", "1"], {root, env});
      expect(result.stopped).to.equal("cap");
      expect(result.iteration).to.equal(3);
      expect(dumperCalls(root), "one dumper round, not two").to.have.lengthOf(1);
      // the round the cap refused has its request written, ready for the next run
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.iteration).to.equal(3);
      expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_MORE_2"]);
      expect(request.seen.TABL, "everything asked before, so the dumper skips it").to.deep.equal(["ZOSD_H5C_HEAD"]);
      let state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.pending.dumpDir).to.equal(dumpDirOf(root, 3));

      // the next run picks up where this one stopped: it executes the
      // pending round, the merge resolves the name, the walk reaches the
      // fixed point
      const second = await run(["--system", "h5c"], {root, env});
      expect(second.stopped).to.equal("fixed-point");
      expect(second.iteration).to.equal(3);
      expect(dumperCalls(root)).to.have.lengthOf(2);
      state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.pending).to.equal(undefined);
      expect(state.dump).to.equal(dumpDirOf(root, 3));
      expect(JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps).to.deep.equal([]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a merge tool that does not know --from-dump says what it needs", async function () {
    this.timeout(180000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {dumper: false, noFromDump: true}));
    try {
      try {
        await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
        expect.fail("the unknown option was swallowed");
      } catch (error) {
        expect(error.message).to.include("needs PR #926 (hana-ddic-gen --from-dump)");
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("refuses unknown options and a first run without a dump", async () => {
    const root = scratch();
    try {
      try {
        await run(["--bogus"], {root, env: {}});
        expect.fail("unknown option accepted");
      } catch (error) {
        expect(error.message).to.include("unknown option");
      }
      try {
        await run([], {root, env: {}});
        expect.fail("a dumpless first run accepted");
      } catch (error) {
        expect(error.message).to.match(/dump/);
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
