// Instrument the transpiler's ordinary Unit metadata and lifecycle for
// per-method results. The generated index.mjs and the Node Unit path stay as
// built; this copy only exports getData().
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {home} from "./home.mjs";

const args = process.argv.slice(2);
const classes = new Set(args.flatMap((x, i) => x === "--class" ? [args[i + 1].toUpperCase()] : []));
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(home, ".local", "gogen-node-results.json");
const original = readFileSync(join(home, "output", "index.mjs"), "utf8");
const exported = original.replace("function getData()", "export function getData()")
  .replace(/run\(\)\.then\(\(\) => \{[\s\S]*$/, "");
if (exported === original || !exported.includes("export function getData()")) throw new Error("transpiler Unit script changed; inspect getData and main call");
const scratch = join(home, "output", "_unit_data.mjs");
writeFileSync(scratch, exported);
const {initializeABAP} = await import(pathToFileURL(join(home, "output", "init.mjs")));
await initializeABAP();
// The DATASET host every real host installs (test/setup.mjs): deny by
// default unless OSD_DATASET_READ/WRITE name roots. Without it a raw runtime
// answers "not supported" where a host answers sy-subrc 8, and the Node side
// of the comparison is not the Node a user runs.
{
  const {installDataset} = await import(pathToFileURL(join(home, "tools", "osd-dataset.mjs")));
  await installDataset(globalThis.abap);
}
const {getData} = await import(pathToFileURL(scratch));
const rows = [];
const messageOf = (e) => String(e?.msg?.get?.() ?? e?.message ?? e ?? "exception");
for (const st of getData().filter((x) => classes.size === 0 || classes.has(x.objectName.toUpperCase()))) {
  const imported = await import(pathToFileURL(join(home, "output", st.filename)));
  const localClass = imported[st.localClass];
  let classError = "";
  try { if (localClass.class_setup) await localClass.class_setup(); } catch (e) { classError = messageOf(e); }
  for (const m of st.methods) {
    const row = {class: st.objectName.toUpperCase(), testclass: st.localClass.toUpperCase(), method: m.name.toUpperCase(), status: "SUCCESS", message: ""};
    if (m.skip) { row.status = "SKIPPED"; row.message = "skipped due to configuration"; rows.push(row); continue; }
    if (classError) { row.status = "FAILED"; row.message = `class_setup: ${classError}`; rows.push(row); continue; }
    let test;
    try {
      test = await (new localClass()).constructor_();
      if (test.setup) await test.setup();
      if (test.FRIENDS_ACCESS_INSTANCE.setup) await test.FRIENDS_ACCESS_INSTANCE.setup();
      if (test.FRIENDS_ACCESS_INSTANCE.SUPER?.setup) await test.FRIENDS_ACCESS_INSTANCE.SUPER.setup();
      await test.FRIENDS_ACCESS_INSTANCE[m.name]();
    } catch (e) { row.status = "FAILED"; row.message = messageOf(e); }
    if (test) try {
      if (test.teardown) await test.teardown();
      if (test.FRIENDS_ACCESS_INSTANCE.teardown) await test.FRIENDS_ACCESS_INSTANCE.teardown();
      if (test.FRIENDS_ACCESS_INSTANCE.SUPER?.teardown) await test.FRIENDS_ACCESS_INSTANCE.SUPER.teardown();
    } catch (e) { row.status = "FAILED"; row.message += ` teardown: ${messageOf(e)}`; }
    rows.push(row);
  }
  try { if (localClass.class_teardown) await localClass.class_teardown(); }
  catch (e) {
    const last = rows.at(-1);
    if (last) { last.status = "FAILED"; last.message += ` class_teardown: ${messageOf(e)}`; }
  }
}
writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} method results in ${out}`);
