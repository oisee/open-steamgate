// SQLite lacks row-level FOR UPDATE. This seam restores the early budget
// read's lock semantics from the ABAP statement (the transpiler drops them),
// and defers only A's own RUNNING-row write to avoid SQLite's database-wide
// writer lock masking concurrency between different SAP pile rows.
import "../../output/init.mjs";
import {openSync, closeSync, unlinkSync, readFileSync} from "node:fs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";
const abap = globalThis.abap, db = abap.context.databaseConnections.DEFAULT;
if (process.env.GOVERNOR_MODULE) await import(process.env.GOVERNOR_MODULE);
const cls = abap.Classes[process.env.GOVERNOR_CLASS ?? "ZCL_L3_FLEET2"];
const source = readFileSync(process.env.GOVERNOR_SOURCE, "utf8");
const method = source.slice(source.indexOf("  METHOD run_rule."), source.indexOf("  ENDMETHOD.", source.indexOf("  METHOD run_rule.")));
const early = method.match(/SELECT SINGLE( FOR UPDATE)? \* FROM zosd_l3_budget INTO ls_budget/);
if (!early) throw new Error("early budget read missing from lock seam");
let held = false, budgetReads = 0, pending;
async function take() {
  while (!held) {
    try { closeSync(openSync(process.env.GOVERNOR_LOCK, "wx")); held = true; }
    catch (e) { if (e.code !== "EEXIST") throw e; await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
}
function release() { if (held) { unlinkSync(process.env.GOVERNOR_LOCK); held = false; } }
const select = db.select, update = db.update, commit = db.commit, rollback = db.rollback;
db.select = async function (options) {
  if (/FROM "?zosd_l3_budget/i.test(options.select)) {
    budgetReads++;
    // The early GLASS read is the only budget access before L2.
    if (budgetReads === 1 && early[1]) await take();
  }
  return select.call(this, options);
};
db.update = async function (options) {
  if (options.table.replaceAll('"', "").toLowerCase() === "zosd_l3_budget") await take();
  if (process.env.GOVERNOR_PAUSE === "1" && options.table.replaceAll('"', "").toLowerCase() === "zosd_l3_pile" && !pending) {
    pending = options;
    return {subrc: 0, dbcnt: 1};
  }
  return update.call(this, options);
};
db.commit = async function () { await commit.call(this); release(); };
db.rollback = async function () { await rollback.call(this); release(); };
const check = abap.Classes.ZCL_L2_SHIP_MIN_CREW.check;
abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = async function (args) {
  if (budgetReads !== 1) throw new Error(`lock seam expected one budget read, got ${budgetReads}`);
  process.send({checking: true, budgetLocked: held, pilePending: !!pending});
  if (process.env.GOVERNOR_PAUSE === "1") {
    await new Promise((resolve) => process.once("message", resolve));
    await update.call(db, pending);
  }
  return check.call(this, args);
};
process.send({ready: true});
await new Promise((resolve) => process.once("message", resolve));
try {
  const result = await dialogStep(() => cls.run_rule({
    iv_run: new abap.types.String().set(process.env.GOVERNOR_RUN),
    iv_rule: new abap.types.String().set("ship-min-crew"),
    iv_date: new abap.types.Date().set("20261001"),
    iv_pile: new abap.types.Integer().set(Number(process.env.GOVERNOR_PILE)),
  }));
  process.send({status: result.get().status.get().trim()});
} catch (e) { process.send({error: String(e?.message ?? e)}); process.exitCode = 1; }
finally { release(); await db.disconnect(); process.disconnect(); }
