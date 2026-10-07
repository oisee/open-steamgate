// Private child: the caller gives this process a complete disposable checkout.
import {readFileSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";
import {pathToFileURL} from "node:url";
import {phase, trace, timingMs} from "./osgjs-trace.mjs";
import {build} from "./osd-build.mjs";
import {modulesOf} from "./osd-transpile.mjs";
import {alertOf} from "./osd-unit.mjs";

const [input, ...owners] = process.argv.slice(2);
const root = process.cwd();
const rows = [];
let compiled = 0;
// Library/setup logs and user console output must not corrupt the JSON protocol.
console.log = (...args) => console.error(...args);
const failure = (error, where) => {
  const alert = alertOf(error, where);
  return {status: alert.kind === "failedAssertion" ? "FAILURE" : "ERROR",
    message: [alert.title, ...alert.details].join("; ")};
};
async function hook(test, name) {
  if (test[name]) await test[name]();
  const access = test.FRIENDS_ACCESS_INSTANCE;
  if (access?.[name]) await access[name]();
  if (access?.SUPER?.[name]) await access.SUPER[name]();
}
try {
  trace("scan");
  const {core} = modulesOf(root);
  const reg = new core.Registry(new core.Config(JSON.stringify({
    global: {files: "/**/*.*"}, syntax: {version: core.Version.OpenABAP}, rules: {parser_error: true},
  })));
  for (const file of readdirSync(input).filter((f) => /\.(abap|xml)$/.test(f)))
    reg.addFile(new core.MemoryFile(file, readFileSync(join(input, file), "utf8")));
  const issues = await phase("parse-input", () => reg.findIssues());
  trace("scan", "end");
  if (issues.length) {
    for (const owner of owners) rows.push({class: owner, status: "NOT_COMPILED", message:
      issues.map((i) => `${i.getFilename()}:${i.getStart().getRow()}: ${i.getMessage()}`).join("\n")});
  }
  const config = JSON.parse(readFileSync(join(root, "abap_transpile.json"), "utf8"));
  const skipped = new Set((config.options?.skip ?? []).map((s) => `${s.object}/${s.class}/${s.method}`.toUpperCase()));
  const groups = owners.flatMap((owner) => reg.getObject("CLAS", owner).getABAPFiles().flatMap((file) =>
    file.getInfo().listClassDefinitions().filter((d) => d.isForTesting && !d.isAbstract && !d.isGlobal).map((d) => ({
      owner, local: d.name.toLowerCase(), module: basename(file.getFilename()).replace(/\.abap$/, ".mjs"),
      methods: d.methods.filter((m) => m.isForTesting).map((m) => m.name.toLowerCase()),
    }))));
  // A methodless include is a no-tests result, without an unnecessary build.
  if (!rows.length && groups.some((g) => g.methods.length)) {
    let output;
    try {
      const made = await phase("build", () => build({root, switch: false, log: (m) => trace(`build:${m}`)}));
      output = join(root, "build/by-input", made.hash, "output");
    }
    catch (error) {
      for (const owner of owners) rows.push({class: owner, status: "NOT_COMPILED", ...(error.signal || error.spawnError ? {source: "harness"} : {}), message: error.message + (error.output ? "\n" + error.output : "")});
    }
    if (!rows.length) {
      const {initializeABAP} = await phase("import", () => import(pathToFileURL(join(output, "init.mjs")).href));
      await phase("initialize/database", () => initializeABAP());
      compiled = owners.length;
      for (const group of groups.filter((g) => g.methods.length)) {
        const base = {class: group.owner, testclass: group.local.toUpperCase()};
        let Class;
        try {
          Class = (await phase(`class:${group.owner}`, () => import(pathToFileURL(join(output, group.module)).href)))[group.local];
          if (!Class) throw new Error(`test class ${group.local} missing from ${group.module}`);
          await phase("class_setup", () => Class.class_setup?.());
        } catch (error) {
          for (const method of group.methods) rows.push({...base, method: method.toUpperCase(), ...failure(error, "class_setup")});
          continue;
        }
        try {
          for (const method of group.methods) {
            const row = {...base, method: method.toUpperCase(), status: "SUCCESS", message: ""};
            if (skipped.has(`${base.class}/${base.testclass}/${row.method}`)) {
              rows.push({...row, status: "SKIPPED", message: "skipped due to configuration"});
              continue;
            }
            const started = performance.now();
            trace(`test:${row.method}`);
            let test;
            try {
              test = await new Class().constructor_();
              await hook(test, "setup");
              const call = test.FRIENDS_ACCESS_INSTANCE?.[method] ?? test[method];
              if (!call) throw new Error(`test method ${method} missing from generated class`);
              await call.call(test.FRIENDS_ACCESS_INSTANCE ?? test);
            } catch (error) { Object.assign(row, failure(error, method)); }
            finally {
              if (test) try { await hook(test, "teardown"); }
              catch (error) {
                const failed = failure(error, "teardown");
                if (row.status === "SUCCESS" || failed.status === "ERROR") Object.assign(row, failed);
                else row.message += "; " + failed.message;
              }
            }
            row.ms = Math.round(performance.now() - started);
            trace(`test:${row.method}`, row.status, row.ms);
            rows.push(row);
          }
        } finally {
          try { await Class.class_teardown?.(); }
          catch (error) { rows.push({...base, ...failure(error, "class_teardown")}); }
        }
      }
    }
  }
} catch (error) { rows.push({source: "harness", status: "ERROR", message: error.message}); }
await new Promise((done) => process.stdout.write(JSON.stringify({classes: owners.length, compiled, rows, timingMs}), done));
// Setup may install timers: this process owns them and its private database.
process.exit(0);
