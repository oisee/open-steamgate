import {expect} from "chai";
import express from "express";
import {cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {Data} from "../tools/osd-data.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {build} from "../tools/osd-build.mjs";

const edited = "ZCL_XW_READER", target = "ZCL_XW_TARGET", long = "ZIF_XW_REFERENCE_LONGER_THAN_THIRTY";
const source = (name, call = "", value = 1) => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
 PUBLIC SECTION. CLASS-METHODS version RETURNING VALUE(rv) TYPE i. ENDCLASS.
 CLASS ${name.toLowerCase()} IMPLEMENTATION. METHOD version.
 ${call} rv = ${value}. ENDMETHOD. ENDCLASS.`;
const calls = `rv = ${target.toLowerCase()}=>version( ).\n DATA extended TYPE REF TO ${long.toLowerCase()}.`;
const delay = ms => new Promise(r => setTimeout(r, ms));

// Own the sources AND the cold baseline. Never edit checkout files or use
// the checkout's live generation, which other suites can leave behind.
describe("ADT xref after a warm swap", function () {
  this.timeout(240000);
  let root, compiler, store, runtime, server, file, marker, timingMarker, served;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-xref-warm-"));
    for (const folder of ["src", "gen", "packs", "data", "webapp"]) cpSync(resolve(folder), join(root, folder), {recursive:true});
    for (const folder of ["test", "node_modules", ".local"]) symlinkSync(resolve(folder), join(root, folder));
    cpSync(resolve("abap_transpile.json"), join(root,"abap_transpile.json"));
    cpSync(resolve("libs.lock.json"), join(root,"libs.lock.json"));
    cpSync(resolve("abaplint.jsonc"), join(root,"abaplint.jsonc"));
    writeFileSync(join(root,"package.json"), "{}");
    mkdirSync(join(root,"src","xref-warm"));
    file = name => join(root,"src","xref-warm", `${name.toLowerCase()}.clas.abap`);
    for (const name of [edited, target]) writeFileSync(file(name), source(name));
    writeFileSync(join(root,"src","xref-warm", `${long.toLowerCase()}.intf.abap`), `INTERFACE ${long.toLowerCase()} PUBLIC. ENDINTERFACE.`);
    marker = join(root,"fail-xref");
    timingMarker = join(root,"delay-xref");
    // Inject a real SQL failure after the first owner DELETE. The startup
    // seed is untouched; only this test's marker arms the serving client.
    const preload = join(root,"fail-xref.mjs");
    writeFileSync(preload, `import {existsSync} from 'node:fs';
      import {SQLiteDatabaseClient} from ${JSON.stringify(new URL("../tools/sqlite-heap-client.mjs", import.meta.url).href)};
      const execute = SQLiteDatabaseClient.prototype.execute;
      SQLiteDatabaseClient.prototype.execute = async function(sql, ...rest) {
        const result = await execute.call(this, sql, ...rest);
        if (existsSync(${JSON.stringify(timingMarker)}) && /^DELETE FROM "cross" WHERE/.test(sql)) await new Promise(r=>setTimeout(r,80));
        if (existsSync(${JSON.stringify(marker)}) && /^DELETE FROM "cross" WHERE/.test(sql)) {
          const value = await abap.Classes[${JSON.stringify(edited)}].version({});
          process.send({type:'xref-injected', value:value.get()});
          throw new Error('injected xref SQL failure');
        }
        return result;
      };`);
    // Other suites can sweep pack outputs from checkout gen/. Recreate this
    // tree's complete baseline from its owned sources before warming it.
    const cold = await build({root});
    expect(cold.ok, JSON.stringify(cold)).to.equal(true);
    store = new ObjectStore({root});
    compiler = new WarmCompiler({root, overlay:s => store.overlay(s), keyOf:f => store.objectKeyOf(f)});
    runtime = new ServingRuntime({root, env:{OSD_WARM:"1", OSD_ADT_ONE_RUNTIME:"1", STG_DB:"sqlite", STG_DB_PATH:"", STG_TLS:"0",
      NODE_OPTIONS:`--import=${preload}`}});
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
    await compiler.prime();
    const app = express();
    served = [];
    // Unprimed read facade: exercise child tables even in split runtime mode.
    app.use(adtRouter({store, data:new Data({runtime}), watch:false, logMisses:false,
      abap:abapRunner({remote:runtime}), abapServed:by => served.push(by)}).router);
    server = await new Promise(done => {const s=app.listen(0,"127.0.0.1",()=>done(s));});
  });
  after(async () => {
    if (server) await new Promise(done=>server.close(done));
    await runtime?.stop();
    compiler?.close();
    if(root) rmSync(root,{recursive:true,force:true});
  });
  const readers = async name => {
    served.length = 0;
    const r = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/http/xref/readers?type=${name === long ? "INTF" : "CLAS"}&name=${name}`);
    expect(r.status).to.equal(200);
    const answer = await r.json();
    expect(answer.source).to.equal("xref");
    expect(served).to.deep.equal(["ABAP"]);
    return answer.readers.map(o=>o.name);
  };
  const swap = built => runtime.hot({generation:built.hash, from:built.from, modules:built.modules,
    only:built.closure, xrefRows:built.xrefRows});

  it("adds and drops short and long references using compiler rows without reparsing", async () => {
    const pid = runtime.child.pid;
    expect(await readers(target)).not.to.include(edited);
    expect(await readers(long)).not.to.include(edited);
    writeFileSync(file(edited), source(edited, calls));
    // The child's tree is deliberately changed AFTER compilation: the
    // swap must use the compiled generation, not today's checkout files.
    const built = await compiler.build();
    expect(built.xrefRows.WBCROSSGT).to.deep.include({OTYPE:"TY",NAME:target,INCLUDE:edited});
    expect(built.xrefRows.WBCROSSGTX).to.deep.include({OTYPE:"TY",NAME:long,INCLUDE:edited});
    writeFileSync(file(edited), source(edited));
    const swapStarted = Date.now();
    const done = await swap(built);
    const wallMs = Date.now() - swapStarted;
    console.log(`      warm timing: build=${built.ms} ms, derive=${built.steps.xref} ms, modules=${done.moduleMs} ms, refresh=${done.xrefMs} ms, swap=${done.ms} ms, IPC wall=${wallMs} ms`);
    expect(done.ms).to.be.at.least(done.moduleMs + done.xrefMs);
    expect(runtime.child.pid).to.equal(pid);
    expect(await readers(target)).to.include(edited);
    expect(await readers(long)).to.include(edited);
    const dropped = await compiler.build();
    await swap(dropped);
    expect(runtime.child.pid).to.equal(pid);
    expect(await readers(target)).not.to.include(edited);
    expect(await readers(long)).not.to.include(edited);
  });

  it("reports the SQL refresh time in the acknowledged swap duration", async () => {
    writeFileSync(file(edited), source(edited, "", 2));
    const built = await compiler.build();
    writeFileSync(timingMarker, "delay");
    let done;
    try {done = await swap(built);} finally {rmSync(timingMarker, {force:true});}
    expect(done.xrefMs).to.be.at.least(80);
    expect(done.ms, "swap metric excluded SQL refresh").to.be.at.least(80);
    writeFileSync(file(edited), source(edited));
    await swap(await compiler.build());
  });

  it("uses an inactive reader's active copy when rebuilding its dependency", async () => {
    writeFileSync(file(edited), source(edited, `DATA ref TYPE REF TO ${target.toLowerCase()}.`));
    await swap(await compiler.build());
    store.write("CLAS", edited, source(edited, `DATA ref TYPE REF TO ${long.toLowerCase()}.`, 99));
    writeFileSync(file(target), source(target, "", 2));
    const built = await compiler.build(new Set([`CLAS ${target}`]));
    expect(built.closure).to.deep.include({type:"CLAS",name:edited});
    await swap(built);
    expect(await readers(target)).to.include(edited);
    expect(await readers(long)).not.to.include(edited);
    // Promote a source without references before the failure test.
    store.write("CLAS", edited, source(edited));
    await swap(await compiler.build(new Set([`CLAS ${edited}`])));

  });

  it("keeps old modules and blocks queued work after a SQL refresh failure until recycle", async () => {
    const pid = runtime.child.pid;
    writeFileSync(file(edited), source(edited));
    await swap(await compiler.build(new Set([`CLAS ${edited}`])));
    writeFileSync(file(edited), source(edited, calls, 7));
    writeFileSync(marker, "fail");
    const injected = new Promise(done => {
      const listen = m => {if(m.type === "xref-injected") {runtime.child.off("message",listen);done(m);}};
      runtime.child.on("message",listen);
    });
    // Exercise ObjectStore's real warm-build -> IPC -> recycle fallback.
    // Hold the fallback briefly to expose the window queued work used to enter.
    const previous = store.warmState, recycle = runtime.recycle;
    let allowFallback, fallbackStarted;
    const gate = new Promise(done => {allowFallback=done;});
    const started = new Promise(done => {fallbackStarted=done;});
    runtime.recycle = async () => {fallbackStarted(); await gate; return recycle.call(runtime);};
    store.served = runtime;
    store.warmState = {...previous, on:true, compiler};
    const publication = store.publish({activate:[{type:"CLAS",name:edited}]});
    let queued;
    try {
      expect((await injected).value, "modules installed before row refresh").to.equal(1);
      await started;
      let answered = false;
      // Use the child's SQL door directly: facade fact preparation can take
      // longer than the observation window and conceal an unlocked child.
      queued = new Data({runtime}).query("SELECT COUNT(*) AS n FROM wbcrossgt")
        .then(() => {answered=true;}, () => {answered=true;});
      await delay(250);
      expect(answered, "failed child released queued work before fallback").to.equal(false);
    } finally {
      rmSync(marker, {force:true});
      allowFallback();
      try {
        const result = await publication;
        expect(result).to.include({ok:true, recycled:true});
        expect(result.why).to.include("injected xref SQL failure");
        await queued;
      } finally {
        runtime.recycle = recycle;
        store.warmState = previous;
      }
    }
    expect(runtime.child.pid).not.to.equal(pid);
    expect(await readers(target)).to.include(edited);
    expect(await readers(long)).to.include(edited);
  });
});
