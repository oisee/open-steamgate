import {l3TableDependencies} from "./helpers/dsl-l3-tables.mjs";
import {jobDoctor, daemonDependencies} from "./helpers/dsl-doctor-mode.mjs";
import {expect} from "chai";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import * as core from "@abaplint/core";
import {compileSet, renderSet} from "../tools/dsl-l3.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";
import {givenText, fill} from "../tools/osd-destination.mjs";

const OUT = "src/l2demo", DATE = "20261001";
const sets = ["fleet", "fleet2"];
const tables = l3TableDependencies().map((file) => basename(file));
const scoped = new Set(tables.filter((f) => /<FIELDNAME>SET_NAME<\/FIELDNAME>/.test(readFileSync(join("src/dsl", f), "utf8"))).map((f) => f.split(".")[0]));
// Parse statements so comments, multiline SQL and strings cannot hide a write.
function writeFindings(text, name) {
  const reg = new core.Registry().addFile(new core.MemoryFile(`${name}.clas.abap`, text)).parse();
  const statements = reg.getFirstObject().getABAPFiles()[0].getStatements();
  const findings = [];
  let writes = 0;
  for (const statement of statements) {
    const sql = statement.concatTokens();
    const table = sql.match(/^(?:UPDATE|DELETE FROM) (zosd_l3_\w+)\b/i)?.[1].toLowerCase();
    if (!scoped.has(table)) continue;
    writes++;
    if (!/\bWHERE\b[\s\S]*\bset_name\s*=\s*c_set\b/i.test(sql)) findings.push(sql);
  }
  return {findings, writes};
}
const source = (set) => readFileSync(`${OUT}/zcl_l3_${set}.clas.abap`, "utf8");
const replace = (text, from, to) => {
  expect(text, `mutant anchor ${from}`).to.include(from);
  return text.replace(from, to);
};

describe("DSL L3 hardening: claims, set-scoped writes and unschedule refusals", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-harden-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  for (const set of sets) {
    it(`${set}: every UPDATE and DELETE of a table with SET_NAME has a set condition`, () => {
      const {findings, writes} = writeFindings(source(set), `zcl_l3_${set}`);
      expect(writes).to.be.greaterThan(2);
      expect(findings).to.deep.equal([]);
    });
    it(`${set}: the job reads its pile FOR UPDATE`, () => {
      const body = source(set).split("  METHOD run_rule.")[1].split("  ENDMETHOD.")[0];
      expect(body).to.match(/SELECT SINGLE FOR UPDATE \* FROM zosd_l3_pile/);
    });
  }
  it("a staged set without resilience also claims only PLANNED piles of the latest held run", async () => {
    const file = `${OUT}/zz_harden_plain_${process.pid}.l3.yaml`;
    const text = readFileSync(`${OUT}/fleet2.l3.yaml`, "utf8")
      .replace(/^governor:\n(  .*\n)+/m, "").replace(/^resilience:\n(  .*\n)+/m, "")
      .replace(/^settings:\n(  .*\n)+/m, "").replace(/^simulate:\n(  .*\n)+/m, "")
      .replace(/^  work:\n(    .*\n)+/m, "").replace("      sim: generated\n", "").replace("  work: real\n", "");
    writeFileSync(file, text);
    try {
      const model = compileSet(file);
      expect(model.resilience).to.equal(undefined);
      const {files} = await renderSet(model);
      const body = files[`${model.class}.clas.abap`].split("  METHOD run_rule.")[1].split("  ENDMETHOD.")[0];
      expect(body).to.include("SELECT SINGLE FOR UPDATE * FROM zosd_l3_pile");
      expect(body).to.include("IF ls_pile-status <> 'PLANNED'.");
      expect(body).to.include("AND run_id = iv_run AND status = 'HELD'.");
    } finally { rmSync(file, {force: true}); }
  });
  it("mutant: removing collect's set condition turns the parsed write check red", () => {
    const text = source("fleet2");
    const start = text.indexOf("  METHOD collect.");
    const tail = replace(text.slice(start), "WHERE set_name = c_set AND run_id = ls_pile-run_id", "WHERE run_id = ls_pile-run_id");
    const {findings} = writeFindings(text.slice(0, start) + tail, "zcl_l3_fleet2");
    expect(findings).to.have.length(1);
    expect(findings[0]).to.match(/UPDATE zosd_l3_pile SET status = 'FAILED'/i);
  });

  describe("on a file database", () => {
    let abap, client, dialogStep, dbPath, env, prior, priorContext, classes, store, drainJobOutbox;
    const str = (s) => new abap.types.String().set(s);
    const date = () => new abap.types.Date().set(DATE);
    const cls = (set) => abap.Classes[`ZCL_L3_${set.toUpperCase()}`];
    const read = (sql, ...params) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...params); } finally { db.close(); }
    };
    const exec = (sql) => dialogStep(async () => { for (const s of sql) await client.execute(s); });
    const snapshot = () => Object.fromEntries(tables.map((f) => f.split(".")[0]).map((t) => [t, read(`SELECT * FROM ${t} ORDER BY rowid`)]));
    const run = (set) => dialogStep(() => cls(set).run({iv_date: date()}));
    const pile = (set, row, name) => dialogStep(() => abap.Classes[(name ?? `zcl_l3_${set}`).toUpperCase()].run_rule({
      iv_date: date(), iv_run: str(row.run_id.trim()), iv_rule: str(row.rule_name.trim()), iv_pile: new abap.types.Integer().set(row.pile_no)}));
    before(async () => {
      await import("./start.mjs");
      prior = globalThis.abap;
      priorContext = {...prior.context, databaseConnections: {...prior.context.databaseConnections}, RFCDestinations: {...prior.context.RFCDestinations}};
      env = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"].map((n) => [n, process.env[n]]));
      dbPath = join(scratch, "business.sqlite");
      process.env.STG_DB = "file"; process.env.STG_DB_PATH = dbPath;
      process.env.OSD_OPERATIONS_DB = join(scratch, "operations.sqlite");
      const {initializeABAP} = await import("../output/init.mjs");
      await initializeABAP();
      abap = globalThis.abap; client = abap.context.databaseConnections.DEFAULT;
      classes = {...abap.Classes};
      const {BatchRuns} = await import("../tools/osd-batch-runs.mjs");
      store = new BatchRuns(process.cwd(), process.env);
      ({drainJobOutbox} = await import("../tools/osd-job-outbox.mjs"));
      ({dialogStep} = await import("../tools/osd-dialog-step.mjs"));
      await exec(["DELETE FROM zosd_l2_ship", "DELETE FROM zosd_l2_voy", "DELETE FROM zosd_l2_crew", "DELETE FROM zosd_l2_cargo",
        "INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S001','Albatross','A')",
        "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00001','S001','20261010')"]);
    });
    const jobModes = {};
    before(async () => { for (const set of ["fleet", "fleet2"]) jobModes[set] = await jobDoctor(set, join(scratch,`job-doctor-${set}`)); });
    beforeEach(() => exec(tables.map((f) => `DELETE FROM ${f.split(".")[0]}`)));
    after(async () => {
      store?.close();
      await client?.disconnect();
      for (const key of Object.keys(abap?.Classes ?? {})) if (!(key in classes)) delete abap.Classes[key];
      Object.assign(abap.Classes, classes);
      Object.assign(prior.context, priorContext); globalThis.abap = prior;
      for (const [n, v] of Object.entries(env)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    });
    // Compile mutated copies to scratch; the generated files are never edited.
    async function mutant(set, suffix, edit) {
      const real = `zcl_l3_${set}`, name = `${real}_h_${suffix}`;
      if (abap.Classes[name.toUpperCase()]) return name;
      const out = join(scratch, name); mkdirSync(out);
      const {Transpiler, core: parser} = modulesOf(process.cwd());
      const reg = new parser.Registry();
      const text = edit((jobModes[set].files[`zcl_l3_${set}.clas.abap`] ?? source(set)).replace(new RegExp(`\\b${real}\\b`, "g"), name));
      for (const [f, t] of Object.entries({[`${name}.clas.abap`]: text,
        [`${name}.clas.xml`]: readFileSync(`${OUT}/${real}.clas.xml`, "utf8").replaceAll(real.toUpperCase(), name.toUpperCase())})) {
        reg.addFile(new parser.MemoryFile(f, lowerNarrowSubmit(t, f, parser)));
      }
      const coreDir = ".local/lars/open-abap-core/src";
      const deps = [...daemonDependencies(),...l3TableDependencies(),
        ...["tbtcjob.tabl.xml", "btcselect.tabl.xml", "btch0000.tabl.xml", "zcl_osd_submit_semantics.clas.abap", "zcl_osd_submit_ranges.clas.abap"].map((f) => join("src/jobs", f)),
        "gen/gui/zcl_osd_batch_report.clas.abap", ".local/lars/open-abap-gui/framework/zif_gg_selection_screen_types.intf.abap",
        // the cockpit's DPC_EXT (zcl_zl3c_*) needs its gen/stg base and the Gateway; the mutants do not
        ...readdirSync(OUT).filter((f) => /\.(abap|xml)$/.test(f) && !f.startsWith(`${real}.`) && !f.startsWith("zcl_zl3c_")).map((f) => join(OUT, f)),
        ...["ddic/ttyp/string_table.ttyp.xml", "ddic/structures/symsg.tabl.xml"].map((f) => join(coreDir, f)),
        ...["uuid", "exceptions", ".", "ddic/dtel", "ddic/doma", "date_time"].flatMap((d) => readdirSync(join(coreDir, d)).filter((f) => /\.(abap|xml)$/.test(f)).map((f) => join(coreDir, d, f)))];
      for (const dep of deps) reg.addDependency(new parser.MemoryFile(basename(dep), readFileSync(dep, "utf8")));
      const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
      const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
      const url = pathToFileURL(join(process.cwd(), "output") + sep).href;
      for (const o of output.objects.filter((o) => o.object.type === "CLAS")) writeFileSync(join(out, o.filename),
        o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (_, f) => `import("${url}${f}")`));
      const cxRoot = abap.Classes.CX_ROOT;
      await import(pathToFileURL(join(out, `${name}.clas.mjs`)).href);
      abap.Classes.CX_ROOT = cxRoot;
      return name;
    }
    async function observedPile(set, row, name) {
      const restores = [];
      let calls = 0;
      for (const rule of compileSet(`${OUT}/${set}.l3.yaml`).rules) {
        const check = abap.Classes[rule.check_class.toUpperCase()];
        const method = rule.filter ? "keys" : "check", original = check[method];
        check[method] = async function (...args) { calls++; return original.apply(this, args); };
        restores.push(() => { check[method] = original; });
      }
      try { return {answer: await pile(set, row, name), calls}; }
      finally { for (const restore of restores) restore(); }
    }
    async function duplicateOracle(set, name) {
      const result = await run(set); const id = result.get().run_id.get().trim();
      const row = read("SELECT * FROM zosd_l3_pile WHERE run_id = ? AND status = 'DONE' ORDER BY pile_no", id)[0];
      expect(row, "completed pile").to.exist;
      // Isolate the pile guard from the released-run guard.
      await exec([`UPDATE zosd_l3_run SET status = 'HELD' WHERE set_name = '${set}'`]);
      const before = snapshot();
      const {answer, calls} = await observedPile(set, row, name);
      return {status: answer.get().status.get().trim(), calls, changed: JSON.stringify(snapshot()) !== JSON.stringify(before)};
    }
    async function staleOracle(set, name, released = false, glass = false) {
      const first = await run(set); const id = first.get().run_id.get().trim();
      const row = read("SELECT * FROM zosd_l3_pile WHERE run_id = ? AND status = 'DONE' ORDER BY pile_no", id)[0];
      if (!released) await run(set);
      if (glass) await exec([`UPDATE zosd_l3_budget SET state = 'GLASS' WHERE run_id = '${id}'`]);
      await exec([`UPDATE zosd_l3_pile SET status = 'PLANNED' WHERE run_id = '${id}' AND rule_name = '${row.rule_name.trim()}' AND pile_no = ${row.pile_no}`,
        ...(!released ? [`UPDATE zosd_l3_run SET status = 'HELD' WHERE set_name = '${set}'`] : [])]);
      const before = snapshot(); const {answer, calls} = await observedPile(set, row, name);
      return {status: answer.get().status.get().trim(), calls, changed: JSON.stringify(snapshot()) !== JSON.stringify(before)};
    }
    for (const set of sets) {
      it(`${set}: a duplicate job for a DONE pile writes nothing`, async () => {
        expect(await duplicateOracle(set)).to.deep.equal({status: "NOT-PLANNED", calls: 0, changed: false});
      });
      it(`${set}: a job of a superseded run writes nothing`, async () => {
        expect(await staleOracle(set)).to.deep.equal({status: "STALE-RUN", calls: 0, changed: false});
      });
      it(`${set}: a job of a released run writes nothing`, async () => {
        expect(await staleOracle(set, undefined, true)).to.deep.equal({status: "STALE-RUN", calls: 0, changed: false});
      });
      it(`${set} mutant: accepting a DONE pile turns the duplicate oracle red`, async () => {
        const name = await mutant(set, "done", (t) => replace(t, "IF ls_pile-status <> 'PLANNED'.", "IF abap_false = abap_true."));
        expect((await duplicateOracle(set, name)).calls).to.be.greaterThan(0);
      });
      it(`${set} mutant: dropping the run guard turns the superseded oracle red`, async () => {
        const name = await mutant(set, "stale", (t) => replace(t,
          "    IF sy-subrc <> 0.\n      rs_rule-status = 'STALE-RUN'.\n      RETURN.\n    ENDIF.\n", ""));
        expect((await staleOracle(set, name)).calls).to.be.greaterThan(0);
      });
    }
    it("fleet2: a superseded job writes nothing even when its old budget is GLASS", async () => {
      expect(await staleOracle("fleet2", undefined, false, true)).to.deep.equal({status: "STALE-RUN", calls: 0, changed: false});
    });
    const deleted = (r) => ({deleted: r.get().deleted.get(), refused: r.get().refused.get()});
    async function refusalOracle(name = "zcl_l3_fleet2") {
      // the oracle's own jobs only: the shard's store may hold another suite's L3_FLEET2 instances,
      // which made unschedule see four and the count flaky; those pass through to the facade untouched
      const key = (r) => `${r.job_name}/${r.job_count}`;
      const before = new Set(store.db.prepare("SELECT job_name, job_count FROM batch_runs").all().map(key));
      await dialogStep(() => cls("fleet2").schedule());
      await drainJobOutbox(store);
      const ours = new Set(store.db.prepare("SELECT job_name, job_count FROM batch_runs WHERE state = 'WAITING'").all().map(key)
        .filter((k) => !before.has(k)));
      expect(ours.size, "the schedule made a driver and a doctor").to.equal(2);
      const port = abap.context.RFCDestinations.JOBS, original = port.call;
      let refusals = 0;
      // Race: a selected waiting job starts before DELETE. The facade answers
      // FORBIDDEN for that now-running job, producing NO_DELETE_AUTHORITY.
      port.call = async function (fm, signature) {
        const job = `${givenText(signature, "IV_JOBNAME").trim()}/${givenText(signature, "IV_JOBCOUNT").trim()}`;
        if (givenText(signature, "IV_COMMAND") === "DELETE" && ours.has(job)) {
          refusals++;
          // Selection already returned status S; the selected instance now
          // starts, before the facade handles its deletion.
          store.db.prepare("UPDATE batch_runs SET state = 'RUNNING' WHERE job_name = ? AND job_count = ?")
            .run(givenText(signature, "IV_JOBNAME").trim(), givenText(signature, "IV_JOBCOUNT").trim());
          fill(signature, {EV_ERROR_CODE: "FORBIDDEN"});
          return;
        }
        return original.call(this, fm, signature);
      };
      try {
        const result = deleted(await dialogStep(() => abap.Classes[name.toUpperCase()].unschedule()));
        expect(refusals, "driver and doctor both refused").to.equal(2);
        const running = store.db.prepare("SELECT job_name, job_count FROM batch_runs WHERE state = 'RUNNING'").all().map(key);
        expect(running.filter((k) => ours.has(k))).to.have.length(2);
        return result;
      } finally {
        port.call = original;
        for (const k of ours) {
          const [n, c] = k.split("/");
          store.db.prepare("UPDATE batch_runs SET state = 'WAITING' WHERE state = 'RUNNING' AND job_name = ? AND job_count = ?").run(n, c);
        }
        await dialogStep(() => cls("fleet2").unschedule());
      }
    }
    it("unschedule distinguishes no jobs from two facade refusals", async () => {
      expect(deleted(await dialogStep(() => cls("fleet2").unschedule()))).to.deep.equal({deleted: 0, refused: 0});
      expect(await refusalOracle()).to.deep.equal({deleted: 0, refused: 2});
    });
    it("unschedule reports a selection error as a refusal, while NO_JOBS_FOUND remains empty", async () => {
      const original = abap.FunctionModules.BP_JOB_SELECT;
      abap.FunctionModules.BP_JOB_SELECT = async () => { throw new abap.ClassicError({classic: "selection_canceled"}); };
      try {
        expect(deleted(await dialogStep(() => cls("fleet2").unschedule()))).to.deep.equal({deleted: 0, refused: 2});
      } finally { abap.FunctionModules.BP_JOB_SELECT = original; }
    });
    it("mutant: swallowing a delete refusal turns the refusal oracle red", async () => {
      const name = await mutant("fleet2", "refuse", (t) => t.replaceAll("rs_deleted-refused = rs_deleted-refused + 1.", "CLEAR rs_deleted-refused."));
      expect(await refusalOracle(name)).to.deep.equal({deleted: 0, refused: 0});
    });
    it("the report prints deleted and refused counts in mode U", () => {
      const report = readFileSync(`${OUT}/zl3_fleet2.prog.abap`, "utf8");
      expect(report).to.include("IF p_mode = 'U'.");
      expect(report).to.include("WRITE: / 'deleted', ls_deleted-deleted, 'refused', ls_deleted-refused.");
    });
  });
});
