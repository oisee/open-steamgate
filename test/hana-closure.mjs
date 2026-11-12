import {expect} from "chai";
import {appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {classifyFindings, parseEnvFile, parseFindings, requestFor, run} from "../tools/hana-closure.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

// H5c: the dependency closure, by iteration (tools/hana-closure.mjs).
//
// Everything here runs against fakes, the way CI must: the dumper is a
// fixture script this test writes (a foreign binary on the bed, spawned by
// path from OSD_HANA_DUMPER with the connection of OSD_HANA_DUMP_ENV), the
// dump merge is a fake host behind OSD_SELF (the real hana-ddic-gen
// --from-dump and hana-src-gen --from-dump arrive with PR #926; the loop
// only owns their argv), and the validate step is the transpiler's own
// validation over a scratch tree whose node_modules is a symlink to this
// checkout's. No HANA is reachable from CI. Names are ZOSD_H5C_* fixtures;
// a real service's names live in the private findings log and its leak list.
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

  it("the request carries names per kind, the iteration, what asked before, and every name", () => {
    const asked = {ZOSD_H5C_ROLE: {kind: "ddic", iteration: 2, finding: "old finding"}};
    const fresh = [
      {name: "ZOSD_H5C_BPA", kind: "tabl", finding: "f"},
      {name: "IF_H5C_BO", kind: "intf", finding: "g"},
    ];
    const request = requestFor({iteration: 3, dump: "/d1", dumpDir: "/d2", fresh, asked, names: ["IF_H5C_BO", "ZOSD_H5C_BPA", "ZOSD_H5C_ROLE"]});
    expect(request.iteration).to.equal(3);
    expect(request.dump).to.equal("/d1");
    expect(request.out, "the directory the dumper writes this round").to.equal("/d2");
    expect(request.new).to.deep.equal({tabl: ["ZOSD_H5C_BPA"], intf: ["IF_H5C_BO"]});
    expect(request.asked_before).to.equal(asked);
    expect(request.names, "the dumper writes the whole closure each round").to.deep.equal(["IF_H5C_BO", "ZOSD_H5C_BPA", "ZOSD_H5C_ROLE"]);
    expect(request.generated_at).to.be.a("string");
  });

  it("reads the dumper's connection env file", () => {
    expect(parseEnvFile([
      "# the connection",
      "H5C_HOST=h5c.example",
      "",
      "export H5C_USER=h5c_user",
      "H5C_PASS=h5c_secret",
    ].join("\n"))).to.deep.equal({H5C_HOST: "h5c.example", H5C_USER: "h5c_user", H5C_PASS: "h5c_secret"});
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

  // a scratch tree that validates like the real one, at fixture scale: the
  // same input-folder shape (the generated DDIC first, the tenant sources,
  // then src), no libraries, and this checkout's transpiler through a
  // symlinked node_modules
  const scratch = () => {
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
    writeFileSync(join(root, "src", "zcl_h5c_loop.clas.abap"), CLAS_SOURCE);
    return root;
  };

  // iteration 1's dump: a dump directory of --ddic shape, carrying nothing
  // the fixture tree needs yet
  const fixtureDump = (dir) => {
    mkdirSync(join(dir, "tables"), {recursive: true});
    writeFileSync(join(dir, "tables", "DD02L.jsonl"), "");
    writeFileSync(join(dir, "manifest.json"), "{}\n");
  };

  // the fake dumper: the argv contract of the real one (`hana dump --name
  // <n> --ddic --out <dir>`, spawned by path), a synthetic dump, and a
  // record of what it saw. H5C_DUMP_TABLES narrows what it "finds"; by
  // default it finds every name it was asked for.
  const fakeDumperSource = () => `#!/usr/bin/env node
import {appendFileSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] !== "hana" || args[1] !== "dump") process.exit(3);
const names = (at("--name") ?? "").split(",").filter(Boolean);
const out = at("--out");
const record = process.env.H5C_RECORD;
if (record) appendFileSync(record, JSON.stringify({
  argv: args,
  names,
  out,
  ddic: args.includes("--ddic"),
  connection: {H5C_HOST: process.env.H5C_HOST, H5C_USER: process.env.H5C_USER, H5C_PASS: process.env.H5C_PASS},
}) + "\\n");
const found = (process.env.H5C_DUMP_TABLES ?? names.join(",")).split(",").filter(Boolean);
mkdirSync(join(out, "tables"), {recursive: true});
writeFileSync(join(out, "tables", "DD02L.jsonl"), found.map((t) => JSON.stringify({TABNAME: t.toUpperCase()})).join("\\n") + "\\n");
writeFileSync(join(out, "manifest.json"), "{}\\n");
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
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {ddicFields, tablXml} from ${JSON.stringify(join(REPO, "tools", "hana-ddic-map.mjs"))};
const args = process.argv.slice(2);
const tool = args[1];
const rest = args.slice(2);
const at = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const log = process.env.H5C_HOST_LOG;
if (log) appendFileSync(log, JSON.stringify({tool, rest}) + "\\n");
if (tool === "hana-ddic-gen.mjs") {
  const dump = at("--from-dump");
  const out = at("--out");
  let rows = [];
  try {
    rows = readFileSync(join(dump, "tables", "DD02L.jsonl"), "utf8").split("\\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  } catch { /* not a dump of --ddic shape: nothing to merge */ }
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
  writeFileSync(join(out, "manifest.json"), "{}\\n");
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
    ...(opts.grow ? {H5C_GROW: "1"} : {}),
    ...(opts.dumper === false ? {} : {
      OSD_HANA_DUMPER: join(root, "fake-dumper.mjs"),
      OSD_HANA_DUMP_ENV: join(root, "dump.env"),
      H5C_RECORD: join(root, "dumper-log.jsonl"),
      ...(opts.dumpTables !== undefined ? {H5C_DUMP_TABLES: opts.dumpTables} : {}),
    }),
  });

  const writeFakes = (root, env) => {
    writeFileSync(join(root, "fake-host.mjs"), fakeHostSource());
    writeFileSync(join(root, "fake-dumper.mjs"), fakeDumperSource());
    chmodSync(join(root, "fake-dumper.mjs"), 0o755);
    writeFileSync(join(root, "dump.env"), "H5C_HOST=h5c.example\nH5C_USER=h5c_user\nH5C_PASS=h5c_secret\n");
    return env;
  };

  const dumperCalls = (root) => readFileSync(join(root, "dumper-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const hostCalls = (root) => readFileSync(join(root, "host-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const outFile = (root, name) => join(root, "gen", "hana-closure", name);

  it("runs to the fixed point: ask, dump through the fake, merge, and the name resolves", async function () {
    this.timeout(180000);
    const root = scratch();
    const dump = join(root, "dump-001");
    fixtureDump(dump);
    const env = writeFakes(root, envFor(root));
    try {
      const result = await run(["--dump", dump, "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      expect(result.iteration).to.equal(2);

      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.iteration).to.equal(2);
      expect(request.dump).to.equal(dump);
      expect(request.out).to.equal(join(root, "gen", "hana-closure", "dump-002"));
      expect(request.new).to.deep.equal({tabl: ["ZOSD_H5C_HEAD"]});
      expect(request.names).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(request.asked_before).to.deep.equal({});

      // the fake dumper saw the whole contract: subcommand, the closure's
      // names, --ddic, its own directory, and the connection of the env file
      const calls = dumperCalls(root);
      expect(calls).to.have.lengthOf(1);
      expect(calls[0].argv.slice(0, 2)).to.deep.equal(["hana", "dump"]);
      expect(calls[0].names).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(calls[0].ddic).to.equal(true);
      expect(calls[0].out).to.equal(join(root, "gen", "hana-closure", "dump-002"));
      expect(calls[0].connection).to.deep.equal({H5C_HOST: "h5c.example", H5C_USER: "h5c_user", H5C_PASS: "h5c_secret"});

      // both merges ran through the host dispatch, twice (two passes)
      const merges = hostCalls(root);
      expect(merges.map((m) => m.tool)).to.deep.equal(
        ["hana-ddic-gen.mjs", "hana-src-gen.mjs", "hana-ddic-gen.mjs", "hana-src-gen.mjs"]);
      expect(merges[0].rest).to.deep.equal(["--from-dump", dump, "--out", join(root, "gen", "hana-ddic")]);
      expect(merges[1].rest).to.deep.equal(
        ["--from-dump", "--dump", dump, "--system", "h5c", "--out", join(root, "gen", "hana-src")]);
      expect(merges[2].rest[1], "the second pass merges the dump the dumper wrote").to.equal(join(root, "gen", "hana-closure", "dump-002"));

      // resolved, so: no gaps, no third round
      expect(JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps).to.deep.equal([]);
      expect(existsSync(join(root, "gen", "hana-closure", "dump-003"))).to.equal(false);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.iteration).to.equal(2);
      expect(state.dump).to.equal(join(root, "gen", "hana-closure", "dump-002"));
      expect(state.asked.ZOSD_H5C_HEAD.kind).to.equal("tabl");
      expect(state.asked.ZOSD_H5C_HEAD.iteration).to.equal(2);
      expect(state.asked.ZOSD_H5C_HEAD.finding).to.match(/Database table or view "zosd_h5c_head" not found/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a name the dumper answered but the build still misses is a gap with its kind and first finding", async function () {
    this.timeout(180000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {dumpTables: ""}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_HEAD");
      expect(gaps[0].kind).to.equal("tabl");
      expect(gaps[0].iteration).to.equal(2);
      expect(gaps[0].finding).to.match(/Database table or view "zosd_h5c_head" not found/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--dry-run writes the request and never starts the dumper", async function () {
    this.timeout(180000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c", "--dry-run"], {root, env});
      expect(result.stopped).to.equal("dry-run");
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.new).to.deep.equal({tabl: ["ZOSD_H5C_HEAD"]});
      expect(existsSync(join(root, "dumper-log.jsonl")), "the dumper was not spawned").to.equal(false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("without the dumper env it stops and prints the command, and a second run resumes", async function () {
    this.timeout(300000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const bare = writeFakes(root, envFor(root, {dumper: false}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env: bare});
      expect(result.stopped).to.equal("no-dumper");
      expect(result.command).to.include(`hana dump --name ZOSD_H5C_HEAD --ddic --out ${join(root, "gen", "hana-closure", "dump-002")}`);
      expect(result.command).to.include(`$OSD_HANA_DUMPER`);

      // the second run takes the dump from the state the first one saved
      const second = await run(["--system", "h5c"], {root, env: writeFakes(root, envFor(root))});
      expect(second.stopped).to.equal("fixed-point");
      expect(second.iteration).to.equal(2);
      expect(dumperCalls(root)).to.have.lengthOf(1);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--max-iterations stops the loop with the pending request on disk", async function () {
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
      expect(request.new.tabl).to.deep.equal(["ZOSD_H5C_MORE_2"]);
      expect(Object.keys(request.asked_before)).to.deep.equal(["ZOSD_H5C_HEAD"]);
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
