import {expect} from "chai";
import {appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {fileURLToPath} from "node:url";
import {classifyFindings, dumperCommand, islandBasenames, parseEnvFile, parseFindings, requestFor, run, tadirKinds} from "../tools/hana-closure.mjs";
import {methodBlocks, stubBodies, stubNamesText} from "../tools/hana-closure-stubs.mjs";
import {buildVerdict, islandObjectCount, islandShrinkCheck, layersDdicCount} from "../tools/hana-closure-merge.mjs";
import {ddicFields, tablXml} from "../tools/hana-ddic-map.mjs";

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
// are PR #926, merged; the loop only owns their argv), and the validate step
// is the transpiler's own validation over a scratch tree whose node_modules
// is a symlink to this checkout's, the converter the loop starts per dump is
// a fixture script (OSD_HANA_CONVERTER) that copies staged layers per dump
// and refuses an --out inside the working tree without --allow-in-repo, like
// the real one, and the fixed point's positive control (the build) is a
// fake-host mode. No
// HANA is reachable from CI. Names are
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
      `check_syntax, RAISE, unknown class zcx_h5c_late, zcl_h5c_app.clas.abap:33`,
      // bed run 5's shapes: a bare `X unknown` type (the kind is the name's
      // prefix), and a friend class the tree does not have
      `unknown_types, ZCX_H5C_API_EXCEPTION unknown, if_h5c_message_buffer.intf.abap:14`,
      `unknown_types, ZIF_H5C_ENGINE unknown, if_h5c_message_buffer.intf.abap:19`,
      `unknown_types, ZOSD_H5C_PARAMS unknown, if_h5c_message_buffer.intf.abap:27`,
      `check_syntax, Friend class zcl_h5c_friend does not exist, cm_h5c_root.clas.abap:7`,
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
      ["ZCX_H5C_LATE", "clas"],
      ["ZCX_H5C_API_EXCEPTION", "clas"],
      ["ZIF_H5C_ENGINE", "intf"],
      ["ZOSD_H5C_PARAMS", "ddic"],
      ["ZCL_H5C_FRIEND", "clas"],
    ];
    expect(names.map((n) => [n.name, n.kind]), "every name, classified, in first-named order").to.deep.equal(want);
    // the first finding that named it rides along -- the gaps file quotes it
    expect(names[0].finding).to.include(`Database table or view "zosd_h5c_bpa" not found`);
    expect(names[0].message, "the message rides beside the raw (the SHLP decision reads it)").to.equal(`Database table or view "zosd_h5c_bpa" not found`);
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
      // the message decides the SHLP extra kind, never the raw line: the
      // raw ends in the file name, and this file is called *searchhelpexits*
      {name: "ZOSD_H5C_FILEONLY", kind: "ddic",
        finding: `unknown_types, Variable "LV_X" contains unknown: ZOSD_H5C_FILEONLY not found, lookup, #zosd#gws_h5c_searchhelpexits.fugr.#zosd#lgws_h5c$01.abap:5`,
        message: `Variable "LV_X" contains unknown: ZOSD_H5C_FILEONLY not found`},
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
    expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_BPA", "ZOSD_H5C_SHLP_EXIT", "ZOSD_H5C_FILEONLY"]);
    expect(request.requested.DTEL).to.deep.equal(["ZOSD_H5C_SHLP_EXIT", "ZOSD_H5C_FILEONLY"]);
    expect(request.requested.TTYP).to.deep.equal(["ZOSD_H5C_SHLP_EXIT", "ZOSD_H5C_FILEONLY"]);
    expect(request.requested.SHLP).to.deep.equal(["ZOSD_H5C_SHLP_EXIT"]);
    expect(request.requested.TABL).to.include("ZOSD_H5C_FILEONLY");
    expect(request.requested.SHLP, "the file name alone never adds the SHLP kind").to.not.include("ZOSD_H5C_FILEONLY");
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

  it("the fake dumper refuses a non-empty --out like the real one", () => {
    // critic r2's S-5: the fake must fail where the real binary fails, or a
    // re-executed pending round slides through a test green (the real
    // dumper refuses the answered directory: prepareOut's "is not empty")
    const root = mkdtempSync(join(tmpdir(), "hana-closure-fakedumper-"));
    try {
      writeFileSync(join(root, "fake-dumper.mjs"), fakeDumperSource());
      chmodSync(join(root, "fake-dumper.mjs"), 0o755);
      mkdirSync(join(root, "req"), {recursive: true});
      writeFileSync(join(root, "req", "closure-request.json"), JSON.stringify({schema: 1, requested: {}}));
      const argv = (out) => [join(root, "fake-dumper.mjs"), "hana", "dump",
        "--host", "h5c.example", "--user", "h5c_user", "--schema", "h5c_schema",
        "--provenance", "p", "--ddic-closure", join(root, "req", "closure-request.json"),
        "--out", out, "--allow-in-repo"];
      mkdirSync(join(root, "out-full"), {recursive: true});
      writeFileSync(join(root, "out-full", "manifest.json"), "{}\n");
      const full = spawnSync(process.execPath, argv(join(root, "out-full")));
      expect(full.status, "the real one refuses a non-empty --out").to.equal(3);
      expect(String(full.stderr)).to.include("not empty");
      const fresh = spawnSync(process.execPath, argv(join(root, "out-new")));
      expect(fresh.status, "an empty --out goes through").to.equal(0);
      expect(existsSync(join(root, "out-new", "manifest.json"))).to.equal(true);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
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

  it("counts the island's classes, interfaces and tables -- objects, not files", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-closure-count-"));
    try {
      mkdirSync(join(root, "gen", "hana-src", "001-h5c", "src"), {recursive: true});
      mkdirSync(join(root, "gen", "hana-ddic"), {recursive: true});
      for (const f of ["zcl_h5c_one.clas.abap", "zcl_h5c_one.clas.xml", "zcl_h5c_one.clas.locals_imp.abap",
        "zcl_h5c_two.clas.abap", "if_h5c_three.intf.abap", "if_h5c_three.intf.xml", "zcl_h5c_prog.prog.abap"]) {
        writeFileSync(join(root, "gen", "hana-src", "001-h5c", "src", f), "x");
      }
      for (const f of ["zosd_h5c_head.tabl.xml", "zosd_h5c_el.dtel.xml", "zosd_h5c_head2.tabl.xml"]) {
        writeFileSync(join(root, "gen", "hana-ddic", f), "x");
      }
      // round 5: the layers carry .tabl.xml too when the converter is the
      // DDIC's writer of record; a stem both folders carry is one object
      for (const f of ["zosd_h5c_layer.tabl.xml", "zosd_h5c_head2.tabl.xml", "zosd_h5c_layer.dtel.xml"]) {
        writeFileSync(join(root, "gen", "hana-src", "001-h5c", "src", f), "x");
      }
      // the class's locals include and xml are the same object; dtel and prog
      // are not in the count (classes+interfaces+tables, the shrink assert's
      // unit)
      expect(islandObjectCount(root)).to.deep.equal({clas: 2, intf: 1, tabl: 3, total: 6});
      expect(islandObjectCount(join(root, "nowhere"))).to.deep.equal({clas: 0, intf: 0, tabl: 0, total: 0});
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the shrink assert is per kind: tables holding a total up is still a lost island", () => {
    // critic r4 S-4: the builder's own first shrink scenario passed because
    // the second dump's new tables compensated the classes it lost
    expect(islandShrinkCheck({clas: 1, intf: 1, tabl: 1, total: 3}, {clas: 1, intf: 1, tabl: 2, total: 4}, 3),
      "every kind non-decreasing stands").to.equal(undefined);
    let thrown;
    try {
      islandShrinkCheck({clas: 1, intf: 1, tabl: 1, total: 3}, {clas: 0, intf: 1, tabl: 3, total: 4}, 3);
      expect.fail("the compensated shrink was accepted");
    } catch (error) {
      thrown = error;
    }
    expect(thrown.message, "both totals are on the abort").to.include("the island shrank: 3 -> 4");
    expect(thrown.message, "the kind that shrank is named").to.include("clas 1 -> 0");
    expect(thrown.message).to.include("classes+interfaces+tables");
  });

  it("counts the DDIC XML the layers carry -- the converter is then the writer of record", () => {
    const root = mkdtempSync(join(tmpdir(), "hana-closure-layerddic-"));
    try {
      mkdirSync(join(root, "layers-001", "layers", "h5c-main", "src"), {recursive: true});
      mkdirSync(join(root, "layers-002", "layers", "h5c-main", "src"), {recursive: true});
      writeFileSync(join(root, "layers-001", "layers", "h5c-main", "src", "zosd_h5c_a.tabl.xml"), "x");
      writeFileSync(join(root, "layers-001", "layers", "h5c-main", "src", "zosd_h5c_b.dtel.xml"), "x");
      writeFileSync(join(root, "layers-001", "plan.json"), "{}\n");
      writeFileSync(join(root, "layers-002", "layers", "h5c-main", "src", "zcl_h5c_x.clas.abap"), "x");
      expect(layersDdicCount([join(root, "layers-001"), join(root, "layers-002")])).to.equal(2);
      expect(layersDdicCount([join(root, "layers-002")]), "no DDIC XML, no count").to.equal(0);
      expect(layersDdicCount([])).to.equal(0);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the positive control: a build that fails with no findings refuses the fixed point", () => {
    // bed run 4's control: osd-build FAILED on a generator step with zero
    // transpiler findings -- the shape the loop must never read as convergence
    const quiet = [
      "osd-build: osd-transpiler.mjs",
      "osd-build: FAILED: node --import tools/osd-generator-reads.mjs tools/cds2ddic.mjs exited 1",
      "osd-build: live generation untouched",
    ].join("\n");
    let quietThrow;
    try {
      buildVerdict(1, quiet);
      expect.fail("the quiet failure was accepted");
    } catch (error) {
      quietThrow = error;
    }
    expect(quietThrow.message, "non-zero exit, zero findings: abort with the FAILED line").to.include("not a fixed point");
    expect(quietThrow.message).to.include("FAILED: node --import");
    expect(buildVerdict(0, "")).to.deep.equal({status: 0, findings: 0});
    expect(buildVerdict(1, `check_syntax, Database table or view "zosd_h5c_head" not found, zcl_h5c_loop.clas.abap:10`),
      "exit 1 with findings only: the walk's ordinary material").to.deep.equal({status: 1, findings: 1});
  });

  // ------------------------------------------------- lazy activation ----

  const STUB_CLASS = [
    `CLASS zcl_h5c_stub DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    TYPES ty_h5c TYPE zosd_h5c_w.`,
    `    METHODS one.`,
    `    METHODS two.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_stub IMPLEMENTATION.`,
    `  METHOD one.`,
    `    RETURN.`,
    `  ENDMETHOD.`,
    `  METHOD two.`,
    `    SELECT SINGLE * FROM zosd_h5c_head INTO @DATA(ls_h5c_head) ##SUBRC_OK.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");
  const findingAt = (line) => parseFindings(`check_syntax, Database table or view "zosd_h5c_head" not found, zcl_h5c_stub.clas.abap:${line}`);

  it("stubs the method a finding names, at the parsed positions, byte-identical around the block", () => {
    const {source: stubbed, stubs, unmatched} = stubBodies(STUB_CLASS, findingAt(12), "zcl_h5c_stub.clas.abap");
    expect(stubs).to.have.lengthOf(1);
    expect(stubs[0].method).to.equal("TWO");
    expect(stubs[0].className).to.equal("ZCL_H5C_STUB");
    expect(stubs[0].missing).to.deep.equal(["ZOSD_H5C_HEAD"]);
    expect(unmatched, "the finding was inside a body").to.deep.equal([]);
    const original = STUB_CLASS.split("\n");
    const out = stubbed.split("\n");
    expect(out.slice(0, 11), "everything before the body").to.deep.equal(original.slice(0, 11));
    expect(out[11]).to.equal(`    RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = 'ZOSD_H5C_HEAD'.`);
    expect(out[12]).to.equal(`  ENDMETHOD.`);
    expect(out.slice(13), "everything after the block").to.deep.equal(original.slice(13));
    // the rewritten file still parses into the same blocks
    expect(methodBlocks(stubbed, "zcl_h5c_stub.clas.abap")).to.have.lengthOf(2);
  });

  it("a definition-level finding is not stubbed: it comes back unmatched and the file stays whole", () => {
    const findings = parseFindings(`unknown_types, Variable "TY_H5C" contains unknown: ZOSD_H5C_W not found, lookup, zcl_h5c_stub.clas.abap:3`);
    const {source: stubbed, stubs, unmatched} = stubBodies(STUB_CLASS, findings, "zcl_h5c_stub.clas.abap");
    expect(stubs, "the definition part has no METHOD block around line 3").to.deep.equal([]);
    expect(unmatched).to.deep.equal(findings);
    expect(stubbed).to.equal(STUB_CLASS);
  });

  it("several findings in one method are one stub: names first-named, a cascade adds none", () => {
    const findings = parseFindings([
      `unknown_types, Variable "LV_ID" contains unknown: ZOSD_H5C_ID not found, lookupDataElement, zcl_h5c_stub.clas.abap:12`,
      `check_syntax, Method or attribute "get_messages" not found, MethodSource, zcl_h5c_stub.clas.abap:12`,
      `check_syntax, Database table or view "zosd_h5c_bpa" not found, zcl_h5c_stub.clas.abap:12`,
    ].join("\n"));
    const {source: stubbed, stubs} = stubBodies(STUB_CLASS, findings, "zcl_h5c_stub.clas.abap");
    expect(stubs).to.have.lengthOf(1);
    expect(stubs[0].finding, "the first finding is the record's").to.match(/contains unknown: ZOSD_H5C_ID/);
    expect(stubs[0].missing, "the cascade's name is not the thing that is missing").to.deep.equal(["ZOSD_H5C_ID", "ZOSD_H5C_BPA"]);
    expect(stubs[0].missingKinds).to.deep.equal([{name: "ZOSD_H5C_ID", kind: "dtel"}, {name: "ZOSD_H5C_BPA", kind: "tabl"}]);
    expect(stubbed).to.include(`missing = 'ZOSD_H5C_ID, ZOSD_H5C_BPA'.`);
  });

  it("a locals_imp include stubs like the class's own file, under the local class's name", () => {
    const locals = [
      `CLASS lcl_h5c_local DEFINITION.`,
      `  PUBLIC SECTION.`,
      `    METHODS go.`,
      `ENDCLASS.`,
      `CLASS lcl_h5c_local IMPLEMENTATION.`,
      `  METHOD go.`,
      `    DATA lv_w TYPE zosd_h5c_w.`,
      `  ENDMETHOD.`,
      `ENDCLASS.`,
      ``,
    ].join("\n");
    const findings = parseFindings(`unknown_types, Variable "LV_W" contains unknown: ZOSD_H5C_W not found, lookup, zcl_h5c_local.clas.locals_imp.abap:7`);
    const {source: stubbed, stubs} = stubBodies(locals, findings, "zcl_h5c_local.clas.locals_imp.abap");
    expect(stubs).to.have.lengthOf(1);
    expect(stubs[0].className).to.equal("LCL_H5C_LOCAL");
    expect(stubs[0].method).to.equal("GO");
    expect(stubbed).to.include(`missing = 'ZOSD_H5C_W'.`);
  });

  it("a file that does not parse stays whole, its findings all unmatched", () => {
    const findings = findingAt(2);
    const {source: stubbed, stubs, unmatched} = stubBodies("this is not abap.", findings, "zcl_h5c_stub.clas.abap");
    expect(stubs).to.deep.equal([]);
    expect(unmatched).to.deep.equal(findings);
    expect(stubbed).to.equal("this is not abap.");
  });

  it("the stub's names list caps at ~200 characters", () => {
    const long = ["ZOSD_H5C_" + "A".repeat(80), "ZOSD_H5C_" + "B".repeat(80), "ZOSD_H5C_" + "C".repeat(80)];
    const text = stubNamesText(long);
    expect(text.length, "the text travels in the exception").to.be.at.most(200);
    expect(text).to.match(/\.\.\.$/);
    expect(stubNamesText(["ZOSD_H5C_HEAD"])).to.equal("ZOSD_H5C_HEAD");
    expect(stubNamesText([])).to.equal("");
  });

  it("the request carries the stubbed names in `deferred`, an optional key beside requested/seen", () => {
    const deferred = [{name: "ZOSD_H5C_HEAD", kind: "tabl", finding: "f"}];
    const request = requestFor({iteration: 2, generation: "g", fresh: [{name: "ZOSD_H5C_DEF", kind: "ddic", finding: "f"}], asked: {}, gaps: [], deferred});
    expect(Object.keys(request).sort(), "the exact key set grows by the optional key").to.deep.equal(
      ["deferred", "gaps", "generation", "iteration", "requested", "schema", "seen", "source"]);
    expect(request.deferred.TABL).to.deep.equal(["ZOSD_H5C_HEAD"]);
    expect(request.deferred.DTEL, "a tabl finding is deferred under TABL only").to.deep.equal([]);
    expect(Object.keys(requestFor({iteration: 2, generation: "g", fresh: [], asked: {}, gaps: []})), "without stubs the key is not there").to.not.include("deferred");
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

  // the stub raise's superclass chain, as scratch-tree fixtures shaped like
  // open-abap-core's src/exceptions/ (a scratch tree carries no libs); the
  // real zcx_osd_not_activated.clas.abap is copied in beside them, so the
  // stub line compiles against the real class
  const IF_MESSAGE_SOURCE = [
    `INTERFACE if_message PUBLIC.`,
    `  METHODS get_text RETURNING VALUE(result) TYPE string.`,
    `  METHODS get_longtext RETURNING VALUE(result) TYPE string.`,
    `ENDINTERFACE.`,
    ``,
  ].join("\n");
  const CX_ROOT_SOURCE = [
    `CLASS cx_root DEFINITION ABSTRACT PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    DATA previous TYPE REF TO cx_root READ-ONLY.`,
    `    DATA textid TYPE c LENGTH 32 READ-ONLY.`,
    `    METHODS constructor`,
    `      IMPORTING`,
    `        textid   LIKE textid OPTIONAL`,
    `        previous TYPE REF TO cx_root OPTIONAL.`,
    `    INTERFACES if_message.`,
    `    ALIASES get_text FOR if_message~get_text.`,
    `ENDCLASS.`,
    `CLASS cx_root IMPLEMENTATION.`,
    `  METHOD constructor.`,
    `    me->previous = previous.`,
    `    me->textid = textid.`,
    `  ENDMETHOD.`,
    `  METHOD if_message~get_text.`,
    `    result = ''.`,
    `  ENDMETHOD.`,
    `  METHOD if_message~get_longtext.`,
    `    result = ''.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");
  const CX_NO_CHECK_SOURCE = [
    `CLASS cx_no_check DEFINITION PUBLIC INHERITING FROM cx_root.`,
    `  PUBLIC SECTION.`,
    `    METHODS constructor`,
    `      IMPORTING`,
    `        textid   LIKE textid OPTIONAL`,
    `        previous TYPE REF TO cx_root OPTIONAL.`,
    `ENDCLASS.`,
    `CLASS cx_no_check IMPLEMENTATION.`,
    `  METHOD constructor.`,
    `    super->constructor( textid = textid previous = previous ).`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  // the lazy-activation fixture: `two` SELECTs a table the island does not
  // have (a method-body finding -> stubbed); a second island class types an
  // attribute by a missing name in its DEFINITION part (outside any body ->
  // cannot be stubbed -> the request)
  const CLAS_STUB_SOURCE = [
    `CLASS zcl_h5c_stub DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    METHODS one.`,
    `    METHODS two.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_stub IMPLEMENTATION.`,
    `  METHOD one.`,
    `    RETURN.`,
    `  ENDMETHOD.`,
    `  METHOD two.`,
    `    SELECT SINGLE * FROM zosd_h5c_head INTO @DATA(ls_h5c_head) ##SUBRC_OK.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  const CLAS_DEF_SOURCE = [
    `CLASS zcl_h5c_def DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
    `  PUBLIC SECTION.`,
    `    DATA gv_h5c TYPE zosd_h5c_def.`,
    `    METHODS run_it.`,
    `ENDCLASS.`,
    `CLASS zcl_h5c_def IMPLEMENTATION.`,
    `  METHOD run_it.`,
    `    RETURN.`,
    `  ENDMETHOD.`,
    `ENDCLASS.`,
    ``,
  ].join("\n");

  // a scratch tree that validates like the real one, at fixture scale: the
  // same input-folder shape (the generated DDIC first, the tenant sources,
  // then src), no libraries, and this checkout's transpiler through a
  // symlinked node_modules. The loop's fixture class is staged OUTSIDE every
  // input folder; the fake converter lays it into gen/hana-src/000-h5c-main/src/
  // on each merge, the way the real converter+hana-src-gen lay the dumped
  // sources -- so the mixed validate() output names files of the
  // island and of src/, and only the island's are classified.
  const scratch = (source = CLAS_SOURCE, name = "zcl_h5c_loop", opts = {}) => {
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
    writeFileSync(join(root, "src", "if_message.intf.abap"), IF_MESSAGE_SOURCE);
    writeFileSync(join(root, "src", "cx_root.clas.abap"), CX_ROOT_SOURCE);
    writeFileSync(join(root, "src", "cx_no_check.clas.abap"), CX_NO_CHECK_SOURCE);
    if (opts.noZcx !== true) {
      mkdirSync(join(root, "src", "hana"), {recursive: true});
      copyFileSync(join(REPO, "src", "hana", "zcx_osd_not_activated.clas.abap"), join(root, "src", "hana", "zcx_osd_not_activated.clas.abap"));
    }
    mkdirSync(join(root, "island"), {recursive: true});
    writeFileSync(join(root, "island", `${name}.clas.abap`), source);
    if (opts.island2Name !== undefined) {
      writeFileSync(join(root, "island", opts.island2Name), opts.island2Source);
    }
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
import {appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
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
// the real prepareOut refuses a non-empty --out (dump.go: "is not empty")
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error("dump out already exists and is not empty: " + out);
  process.exit(3);
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
const unhandledKinds = (process.env.H5C_UNHANDLED_KINDS ?? "").split(",").filter(Boolean);
const resolved = {};
const missing = {};
const unhandled = {};
for (const kind of Object.keys(request.requested)) {
  const list = request.requested[kind] ?? [];
  if (list.length === 0) continue;
  (missingKinds.includes(kind) ? missing : unhandledKinds.includes(kind) ? unhandled : resolved)[kind] = [...list].sort();
}
const found = missingKinds.includes("TABL") || unhandledKinds.includes("TABL") ? [] : (request.requested.TABL ?? []);
mkdirSync(join(out, "tables"), {recursive: true});
writeFileSync(join(out, "tables", "DD02L.jsonl"), found.map((t) => JSON.stringify({TABNAME: t.toUpperCase()})).join("\\n") + (found.length === 0 ? "" : "\\n"));
const closure = {rounds: 1, resolved, missing};
if (Object.keys(unhandled).length > 0) closure.unhandled = unhandled;
writeFileSync(join(out, "manifest.json"), JSON.stringify({closure}) + "\\n");
process.exit(0);
`;

  // the fake host behind OSD_SELF: the argv of hana-ddic-gen --from-dump and
  // hana-src-gen --layers is what the loop owns (the real tools' write modes
  // are PR #926's and this tree's), so the fake asserts it and emulates the
  // merge. The DDIC half writes the same XML the real mapper writes -- it
  // has to, the transpiler must resolve it for the fixed point -- and never
  // clears the folder, the way the real --from-dump writes per-file overlays.
  // The source half lays the UNION of the --layers dirs (later wins per
  // file), the way the real hana-src-gen does; H5C_SHRINK=1 makes it
  // reproduce the round-3 bug (only the last dump's layers) for the
  // shrink-assert test. H5C_GROW=1 drops one more unresolved table into the
  // second merge, so the closure keeps growing and a cap has something to
  // stop. tool osd-build.mjs is the fixed point's positive control: ok by
  // default, H5C_BUILD=fail-quiet is the generator crash bed run 4 saw
  // (non-zero exit, zero findings), H5C_BUILD=fail-findings exits non-zero
  // carrying a finding line.
  const fakeHostSource = () => `#!/usr/bin/env node
import {appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
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
  // the loop merges LAYERS (the union of every dump so far), never one dump:
  // --layers <dir>... --out <dir>, the argv tools/hana-src-gen.mjs takes
  const out = at("--out");
  const dirs = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === "--layers") dirs.push(rest[i + 1]);
  if (dirs.length === 0) {
    console.error("fake host: the loop must merge layers (--layers), not a dump");
    process.exit(2);
  }
  const shown = process.env.H5C_SHRINK === "1" ? [dirs[dirs.length - 1]] : dirs;
  rmSync(out, {recursive: true, force: true});
  mkdirSync(out, {recursive: true});
  for (const dir of shown) {
    const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
    for (const layer of plan.layers ?? []) {
      const target = join(out, String(layer.order).padStart(3, "0") + "-" + layer.name);
      mkdirSync(join(target, "src"), {recursive: true});
      copyFileSync(join(dir, layer.folder, ".abapgit.xml"), join(target, ".abapgit.xml"));
      for (const file of readdirSync(join(dir, layer.folder, "src"))) {
        copyFileSync(join(dir, layer.folder, "src", file), join(target, "src", file));
      }
    }
  }
  const last = JSON.parse(readFileSync(join(dirs[dirs.length - 1], "plan.json"), "utf8"));
  writeFileSync(join(out, "manifest.json"), JSON.stringify({dump: last.dump ?? {manifest_sha256: "h5c_sha"}}) + "\\n");
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
if (tool === "osd-build.mjs") {
  const mode = process.env.H5C_BUILD ?? "ok";
  if (mode === "fail-quiet") {
    console.log("osd-build: osd-transpiler.mjs");
    console.log("osd-build: FAILED: node --import tools/osd-generator-reads.mjs tools/cds2ddic.mjs exited 1");
    console.log("osd-build: live generation untouched");
    process.exit(1);
  }
  if (mode === "fail-findings") {
    console.log('check_syntax, Database table or view "zosd_h5c_head" not found, zcl_h5c_loop.clas.abap:10');
    process.exit(1);
  }
  process.exit(0);
}
process.exit(2);
`;

  // the fake converter the loop starts per dump (OSD_HANA_CONVERTER, an
  // external script like the real dump-to-layers.mjs): it copies the staged
  // converter output of the dump it was handed -- and refuses an --out
  // inside a git working tree unless --allow-in-repo, the real converter's
  // own refusal (dump-to-layers.mjs rejectGit, word for word), and records
  // its argv the way the fake dumper does. The loop's layers dir sits under
  // .local/ INSIDE the tree, so every loop scenario is green only when the
  // flag travels (the .git scenarios run the refusal end to end).
  const fakeConverterSource = () => `#!/usr/bin/env node
import {appendFileSync, cpSync, existsSync, rmSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
const args = process.argv.slice(2);
const at = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// an --out inside a git working tree is refused unless --allow-in-repo
const out = resolve(at("--out"));
for (let dir = out; ; dir = dirname(dir)) {
  if (existsSync(join(dir, ".git"))) {
    if (args.includes("--allow-in-repo") === false) {
      console.error("Refusing to write inside a git working tree: " + out + " (use --allow-in-repo)");
      process.exit(3);
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
}
const record = process.env.H5C_CONV_RECORD;
if (record) appendFileSync(record, JSON.stringify({argv: args, out, allowInRepo: args.includes("--allow-in-repo")}) + "\\n");
const map = JSON.parse(process.env.H5C_CONV_MAP ?? "{}");
const source = map[args[0]];
if (source === undefined) {
  console.error("no staged layers for " + args[0]);
  process.exit(3);
}
rmSync(at("--out"), {recursive: true, force: true});
cpSync(source, at("--out"), {recursive: true});
process.exit(0);
`;

  // a staged converter output (what the fake converter copies into --out):
  // plan.json with one layer, .abapgit.xml, src/ with the files
  const ABAPGIT_XML = `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA><MASTER_LANGUAGE>E</MASTER_LANGUAGE><STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>PREFIX</FOLDER_LOGIC></DATA>
 </asx:values>
</asx:abap>
`;
  const converterOut = (dir, files = []) => {
    mkdirSync(join(dir, "layers", "h5c-main", "src"), {recursive: true});
    writeFileSync(join(dir, "layers", "h5c-main", ".abapgit.xml"), ABAPGIT_XML);
    writeFileSync(join(dir, "plan.json"), JSON.stringify({
      schema: 1, system: "h5c",
      dump: {manifest_sha256: "h5c_sha", provenance: "the h5c fixtures' own test bed"},
      layers: [{name: "h5c-main", package: "$ZOSD_H5C", folder: "layers/h5c-main", order: 0,
        objects: files.length === 0 ? {} : {CLAS: files.length}, requires: [], requires_outside: [],
        closure: {unresolved: 0, items: []}}],
      cycles: [], no_source: {}, orphans: [], errors: [],
      empty_layers: {count: 0, names: []}, unpackaged_groups: 0,
    }, null, 2) + "\n");
    for (const [name, from] of files) copyFileSync(from, join(dir, "layers", "h5c-main", "src", name));
    return dir;
  };

  const envFor = (root, opts = {}) => {
    // every dump's layers are staged here, and the fake converter copies the
    // staged tree of the dump it was handed (H5C_CONV_MAP keys the dump
    // paths): dump-001 carries the island class(es), the dumper's dumps are
    // empty unless opts.convBFiles names more
    const island = opts.island ?? "zcl_h5c_loop.clas.abap";
    const filesA = [[island, join(root, "island", island)]];
    if (opts.island2Name !== undefined) filesA.push([opts.island2Name, join(root, "island", opts.island2Name)]);
    // extra staged files of the seed dump's layer -- the converter-DDIC
    // scenario stages the .tabl.xml the converter master writes
    for (const name of opts.convAFiles ?? []) filesA.push([name, join(root, "island", name)]);
    const filesB = (opts.convBFiles ?? []).map((name) => [name, join(root, "island", name)]);
    const convMap = JSON.stringify({
      [join(root, "dump-001")]: converterOut(join(root, "conv-a"), filesA),
      [dumpDirOf(root, 2)]: converterOut(join(root, "conv-b"), filesB),
      [dumpDirOf(root, 3)]: converterOut(join(root, "conv-c"), filesB),
    });
    return {
      ...process.env,
      OSD_SELF: JSON.stringify([process.execPath, join(root, "fake-host.mjs")]),
      H5C_HOST_LOG: join(root, "host-log.jsonl"),
      OSD_HANA_CONVERTER: join(root, "fake-converter.mjs"),
      H5C_CONV_MAP: convMap,
      H5C_CONV_RECORD: join(root, "converter-log.jsonl"),
      ...(opts.shrink ? {H5C_SHRINK: "1"} : {}),
      ...(opts.build !== undefined ? {H5C_BUILD: opts.build} : {}),
      ...(opts.grow ? {H5C_GROW: "1"} : {}),
      ...(opts.noFromDump ? {H5C_NO_FROM_DUMP: "1"} : {}),
      ...(opts.missingKinds !== undefined ? {H5C_MISSING_KINDS: opts.missingKinds} : {}),
      ...(opts.unhandledKinds !== undefined ? {H5C_UNHANDLED_KINDS: opts.unhandledKinds} : {}),
      ...(opts.refuse !== undefined ? {H5C_REFUSE: opts.refuse} : {}),
      ...(opts.dumper === false ? {OSD_HANA_DUMP_ENV: join(root, "dump.env")} : {
        OSD_HANA_DUMPER: join(root, "fake-dumper.mjs"),
        OSD_HANA_DUMP_ENV: join(root, "dump.env"),
        H5C_RECORD: join(root, "dumper-log.jsonl"),
      }),
    };
  };

  const writeFakes = (root, env) => {
    writeFileSync(join(root, "fake-host.mjs"), fakeHostSource());
    writeFileSync(join(root, "fake-converter.mjs"), fakeConverterSource());
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
  const converterCalls = (root) => readFileSync(join(root, "converter-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const hostCalls = (root) => readFileSync(join(root, "host-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const outFile = (root, name) => join(root, "gen", "hana-closure", name);
  const dumpDirOf = (root, n) => join(root, ".local", "hana-closure", `dump-${String(n).padStart(3, "0")}`);
  const layersDirOf = (root, n) => join(root, ".local", "hana-closure", `layers-${String(n).padStart(3, "0")}`);

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

      // both merges ran through the host dispatch, twice (two passes), and
      // the fixed point's positive control ran the build through it too
      const merges = hostCalls(root);
      expect(merges.map((m) => m.tool)).to.deep.equal(
        ["hana-ddic-gen.mjs", "hana-src-gen.mjs", "hana-ddic-gen.mjs", "hana-src-gen.mjs", "osd-build.mjs"]);
      expect(merges[0].rest).to.deep.equal(["--from-dump", dump, "--out", join(root, "gen", "hana-ddic")]);
      expect(merges[1].rest, "the first pass lays the seed dump's layers").to.deep.equal(
        ["--layers", layersDirOf(root, 1), "--out", join(root, "gen", "hana-src")]);
      expect(merges[2].rest[1], "the second pass merges the dump the dumper wrote").to.equal(dumpDirOf(root, 2));
      expect(merges[3].rest, "the second pass lays the union of both dumps' layers").to.deep.equal(
        ["--layers", layersDirOf(root, 1), "--layers", layersDirOf(root, 2), "--out", join(root, "gen", "hana-src")]);

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
      const stateAfter = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(stateAfter.pending, "the hand-run dump superseded the pending round").to.equal(undefined);
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
        expect(error.message).to.include("predates --from-dump (PR #926, merged)");
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--stub-unresolved: the unresolvable method is stubbed, the definition-level name is requested, deferred is written", async function () {
    this.timeout(300000);
    const root = scratch(CLAS_STUB_SOURCE, "zcl_h5c_stub", {island2Name: "zcl_h5c_def.clas.abap", island2Source: CLAS_DEF_SOURCE});
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_stub.clas.abap", island2Name: "zcl_h5c_def.clas.abap"}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c", "--stub-unresolved"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      expect(dumperCalls(root), "one dumper round: the stub unblocked the activation").to.have.lengthOf(1);

      // the pass-1 request is still on disk (the second pass asked nothing):
      // the definition-level name is requested, the method's name is
      // deferred, and the stubbed method's name is in neither requested nor
      // the gaps
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.requested.TABL).to.deep.equal(["ZOSD_H5C_DEF"]);
      expect(request.requested.DTEL, "the kind-less definition name under every dictionary kind").to.deep.equal(["ZOSD_H5C_DEF"]);
      expect(request.deferred.TABL).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(JSON.stringify(request.requested), "the stubbed method's name is not requested").to.not.include("ZOSD_H5C_HEAD");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps, "the island grew, nothing is a gap").to.deep.equal([]);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.asked.ZOSD_H5C_HEAD, "the deferred name was never asked").to.equal(undefined);

      // the stub is in the island file, byte-checked around the parsed block
      const stubbedSource = readFileSync(join(root, "gen", "hana-src", "000-h5c-main", "src", "zcl_h5c_stub.clas.abap"), "utf8");
      const before = CLAS_STUB_SOURCE.split("\n");
      const after = stubbedSource.split("\n");
      expect(after.slice(0, 10), "everything before the body").to.deep.equal(before.slice(0, 10));
      expect(after[10]).to.equal(`    RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = 'ZOSD_H5C_HEAD'.`);
      expect(after[11]).to.equal(`  ENDMETHOD.`);
      expect(after.slice(12), "everything after the block").to.deep.equal(before.slice(12));

      // the stubs file: the second pass stubbed the same method again (the
      // deferred name is never dumped), so the record stands -- that is the
      // design: the island grows only on a real miss
      const record = JSON.parse(readFileSync(outFile(root, "closure-stubs.json"), "utf8"));
      expect(record).to.have.lengthOf(1);
      expect(record[0].file).to.equal(join("gen", "hana-src", "000-h5c-main", "src", "zcl_h5c_stub.clas.abap"));
      expect(record[0].class).to.equal("ZCL_H5C_STUB");
      expect(record[0].method).to.equal("TWO");
      expect(record[0].missing).to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(record[0].finding).to.match(/Database table or view "zosd_h5c_head" not found/);

      // the iterator said what it did: per class, the count and the
      // generation hash; the walk reached "no stubbable finding"
      expect(said.some((l) => l === "stub round 1: ZCL_H5C_STUB: 1 method(s) stubbed (generation h5c_sha)")).to.equal(true);
      expect(said.some((l) => /^stub: no stubbable finding remains after [0-9]+ round\(s\)$/.test(l))).to.equal(true);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("--stub-unresolved caps at --max-stub-rounds and leaves the rest in the request", async function () {
    this.timeout(300000);
    // no exception class in the tree: the stub itself cannot resolve, so
    // every round would stub again -- the cap stops the rewriting and the
    // leftover names stay in the request
    const root = scratch(CLAS_STUB_SOURCE, "zcl_h5c_stub", {noZcx: true});
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_stub.clas.abap"}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c", "--stub-unresolved", "--max-stub-rounds", "1"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      expect(said.filter((l) => l.startsWith("stub cap:")).length, "the cap said itself in both passes").to.be.at.least(2);
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(request.deferred.TABL, "the first stub's name is deferred").to.deep.equal(["ZOSD_H5C_HEAD"]);
      expect(JSON.stringify(request), "the stub raise's own class is still missing: the request asks for it").to.include("ZCX_OSD_NOT_ACTIVATED");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps.map((g) => g.name)).to.include("ZCX_OSD_NOT_ACTIVATED");
      expect(gaps.map((g) => g.name), "the stubbed name is not a gap").to.not.include("ZOSD_H5C_HEAD");
      const stubbedSource = readFileSync(join(root, "gen", "hana-src", "000-h5c-main", "src", "zcl_h5c_stub.clas.abap"), "utf8");
      expect(stubbedSource).to.include(`RAISE EXCEPTION TYPE zcx_osd_not_activated EXPORTING missing = 'ZOSD_H5C_HEAD'.`);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("without --stub-unresolved the same island is round 2: everything is requested, nothing is stubbed", async function () {
    this.timeout(300000);
    const root = scratch(CLAS_STUB_SOURCE, "zcl_h5c_stub", {island2Name: "zcl_h5c_def.clas.abap", island2Source: CLAS_DEF_SOURCE});
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_stub.clas.abap", island2Name: "zcl_h5c_def.clas.abap"}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      const request = JSON.parse(readFileSync(outFile(root, "closure-request.json"), "utf8"));
      expect(Object.keys(request), "no deferred key without the flag").to.not.include("deferred");
      expect([...request.requested.TABL].sort()).to.deep.equal(["ZOSD_H5C_DEF", "ZOSD_H5C_HEAD"]);
      expect(existsSync(outFile(root, "closure-stubs.json")), "no stubs file without the flag").to.equal(false);
      const islandFile = readFileSync(join(root, "gen", "hana-src", "000-h5c-main", "src", "zcl_h5c_stub.clas.abap"), "utf8");
      expect(islandFile).to.not.include("RAISE EXCEPTION");
      expect(said.some((l) => l.startsWith("stub ")), "no stub line without the flag").to.equal(false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the island accumulates: a second dump that lacks the first's objects cannot erase them", async function () {
    this.timeout(300000);
    // FIX-4 (bed run 5): each hana-src-gen --from-dump REPLACED gen/hana-src,
    // so iteration 2 validated a tree without the service and the fixed point
    // was false. The island is the UNION of the seed dump and every dump so
    // far, later wins per object: the fake converter stages each dump's
    // layers, the fake host lays the union, and the first dump's class must
    // still be in the island at the fixed point.
    const SECOND_SOURCE = [
      `CLASS zcl_h5c_second DEFINITION PUBLIC FINAL CREATE PUBLIC.`,
      `  PUBLIC SECTION.`,
      `    METHODS run_it.`,
      `ENDCLASS.`,
      `CLASS zcl_h5c_second IMPLEMENTATION.`,
      `  METHOD run_it.`,
      `    SELECT SINGLE * FROM zosd_h5c_head INTO @DATA(ls_h5c_second) ##SUBRC_OK.`,
      `  ENDMETHOD.`,
      `ENDCLASS.`,
      ``,
    ].join("\n");
    const root = scratch(CLAS_SOURCE, "zcl_h5c_loop", {island2Name: "zcl_h5c_second.clas.abap", island2Source: SECOND_SOURCE});
    mkdirSync(join(root, ".git"));
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_loop.clas.abap", convBFiles: ["zcl_h5c_second.clas.abap"]}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      expect(result.iteration).to.equal(2);
      const island = join(root, "gen", "hana-src", "000-h5c-main", "src");
      expect(existsSync(join(island, "zcl_h5c_loop.clas.abap")), "the first dump's class survived the second merge").to.equal(true);
      expect(existsSync(join(island, "zcl_h5c_second.clas.abap")), "the second dump's class is there").to.equal(true);
      expect(existsSync(join(root, "gen", "hana-ddic", "zosd_h5c_head.tabl.xml")), "the DDIC accumulated (per-file overlays)").to.equal(true);
      // the counts are on the iteration lines and never went down
      expect(said.filter((l) => /island object/.test(l))).to.have.lengthOf(2);
      expect(said.some((l) => l.includes("iteration 1:") && l.includes("1 island object(s)"))).to.equal(true);
      expect(said.some((l) => l.includes("iteration 2:") && l.includes("3 island object(s)"))).to.equal(true);
      // the state remembers the layers dirs per dump, and the object count
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.layers).to.have.lengthOf(2);
      expect(state.islandObjects).to.deep.equal({clas: 2, intf: 0, tabl: 1, total: 3});
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("the converter is the writer of record: DDIC XML in the layers skips hana-ddic-gen", async function () {
    this.timeout(300000);
    // round 5 (a4h-i7): the converter master writes .tabl/.dtel/.doma/.ttyp
    // XML from the dump's DD* rows, and the layers carry it into the build
    // through hana-src-gen alone. The loop must not write gen/hana-ddic
    // from the dump on top of it: the step is skipped (one log line says
    // so), the table resolves from the layer, and the walk converges with
    // NO dumper round and NO hana-ddic-gen call. The cross-check
    // (--from-dump --against <layers>) is a follow-up, not built.
    const root = scratch(CLAS_SOURCE);
    writeFileSync(join(root, "island", "zosd_h5c_head.tabl.xml"),
      tablXml({name: "ZOSD_H5C_HEAD", text: "h5c fixture", clidep: false,
        fields: ddicFields([{position: "1", fieldname: "ZOSD_H5C_KEY", keyflag: "X", rollname: "",
          datatype: "CHAR", leng: "10", decimals: "0", inttype: "C", intlen: "000020", notnull: "X"}])}));
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_loop.clas.abap", convAFiles: ["zosd_h5c_head.tabl.xml"]}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped).to.equal("fixed-point");
      expect(result.iteration, "the layer closed the name: no dumper round").to.equal(1);
      expect(existsSync(join(root, "dumper-log.jsonl")), "no dumper round ran").to.equal(false);
      const merges = hostCalls(root);
      expect(merges.map((m) => m.tool), "no hana-ddic-gen: the converter wrote the table").to.deep.equal(
        ["hana-src-gen.mjs", "osd-build.mjs"]);
      expect(merges[0].rest).to.deep.equal(
        ["--layers", layersDirOf(root, 1), "--out", join(root, "gen", "hana-src")]);
      // the converter's argv is the real converter's contract, with the flag
      // the in-tree layers dir needs: .local/hana-closure/ sits inside the
      // git working tree, which the converter refuses to write without
      // --allow-in-repo (the fake refuses it with the real wording; the
      // .git scenarios run that refusal end to end)
      const convs = converterCalls(root);
      expect(convs).to.have.lengthOf(1);
      expect(convs[0].argv.slice(0, 1)).to.deep.equal([join(root, "dump-001")]);
      expect(convs[0].out).to.equal(layersDirOf(root, 1));
      expect(convs[0].argv.join(" ")).to.include("--system h5c");
      expect(convs[0].allowInRepo, "the layers land inside the tree: the flag must travel").to.equal(true);
      expect(said.some((l) => l.includes("the layers carry the DDIC XML (1 file(s)) -- hana-ddic-gen --from-dump is skipped, the converter is the writer of record")),
        "the skip says itself").to.equal(true);
      expect(existsSync(join(root, "gen", "hana-ddic")), "gen/hana-ddic is not written").to.equal(false);
      expect(existsSync(join(root, "gen", "hana-src", "000-h5c-main", "src", "zosd_h5c_head.tabl.xml")), "the layer carries the table").to.equal(true);
      const state = JSON.parse(readFileSync(outFile(root, "state.json"), "utf8"));
      expect(state.islandObjects, "the layer's table counts (the shrink control is not blind)").to.deep.equal({clas: 1, intf: 0, tabl: 1, total: 2});
      expect(JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps).to.deep.equal([]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("an unhandled kind is unanswered, not missing: a kind's missing wins over it", async function () {
    this.timeout(300000);
    // closure.unhandled = the request kinds the
    // dumper's closure does not follow (FIX-1's dumper update). TABL and
    // DTEL answered missing (does not exist), TTYP is unanswered: the gap
    // stands under the missing kind, and the unhandled entry adds neither
    // a kind nor a reason
    const root = scratch(CLAS_TYPE_SOURCE, "zcl_h5c_type");
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_type.clas.abap", missingKinds: "TABL,DTEL", unhandledKinds: "TTYP"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_W");
      expect(gaps[0].kind, "the missing kind, not the unhandled one").to.be.oneOf(["TABL", "DTEL"]);
      expect(gaps[0].reason, "does-not-exist is the stronger word: no unhandled reason").to.equal(undefined);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a name unanswered only under unhandled kinds gaps with the unhandled reason", async function () {
    this.timeout(300000);
    const root = scratch(CLAS_TYPE_SOURCE, "zcl_h5c_type");
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_type.clas.abap", unhandledKinds: "TABL,DTEL,TTYP"}));
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
      expect(result.stopped).to.equal("fixed-point");
      const gaps = JSON.parse(readFileSync(outFile(root, "closure-gaps.json"), "utf8")).gaps;
      expect(gaps).to.have.lengthOf(1);
      expect(gaps[0].name).to.equal("ZOSD_H5C_W");
      expect(gaps[0].kind).to.equal("TABL");
      expect(gaps[0].reason).to.equal("unhandled by the dumper's closure");
      expect(gaps[0].iterations_requested).to.equal(2);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a shrinking island aborts the run with both counts", async function () {
    this.timeout(300000);
    // the assert behind the accumulation: if the merge ever loses objects
    // (H5C_SHRINK=1 makes the fake host write only the last dump's layers --
    // the round-3 bug, on demand), the run dies instead of "converging"
    const root = scratch(CLAS_SOURCE, "zcl_h5c_loop", {island2Name: "zcl_h5c_def.clas.abap", island2Source: CLAS_DEF_SOURCE});
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {island: "zcl_h5c_loop.clas.abap", island2Name: "zcl_h5c_def.clas.abap", shrink: true, missingKinds: "TABL"}));
    try {
      try {
        await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
        expect.fail("the shrinking island was not caught");
      } catch (error) {
        expect(error.message).to.include("the island shrank: 2 -> 0");
        expect(error.message).to.include("clas 2 -> 0");
        expect(error.message).to.include("classes+interfaces+tables");
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a build that fails with no findings is not a fixed point", async function () {
    this.timeout(300000);
    // bed run 4's control: osd-build FAILED on a generator step with zero
    // transpiler findings, and the loop read that as convergence. The fixed
    // point now needs the build's own exit code.
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {build: "fail-quiet"}));
    try {
      try {
        await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env});
        expect.fail("the empty validate was trusted as a fixed point");
      } catch (error) {
        expect(error.message).to.include("not a fixed point");
        expect(error.message).to.include("FAILED: node --import");
      }
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a failed build that still carries findings leaves the fixed point standing", async function () {
    this.timeout(300000);
    const root = scratch();
    fixtureDump(join(root, "dump-001"));
    const env = writeFakes(root, envFor(root, {build: "fail-findings"}));
    const said = [];
    try {
      const result = await run(["--dump", join(root, "dump-001"), "--system", "h5c"], {root, env, say: (m) => said.push(m)});
      expect(result.stopped, "exit 1 with findings only: the walk's ordinary material").to.equal("fixed-point");
      expect(said.some((l) => l.startsWith("build: exited 1 with 1 finding(s)"))).to.equal(true);
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
