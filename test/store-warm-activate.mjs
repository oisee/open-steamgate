import {expect} from "chai";
import {zipInProcess} from "../tools/osd-abapgit-zip.mjs";
import {userLayersOf} from "../tools/osd-source-layers.mjs";
import {fork} from "node:child_process";
import {once} from "node:events";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination, withSystem} from "../tools/osd-store-destination.mjs";
import {ActivationJournal} from "../tools/osd-activation-journal.mjs";
import {WarmCompilerProcess} from "../tools/osd-warm-process.mjs";
import {closeWarm} from "../tools/osd-store-warm.mjs";
import {ensureTmp} from "../tools/osd-tmp.mjs";
import {liveHash} from "../tools/osd-build.mjs";

const repo = resolve(".");
const target = {type: "CLAS", name: "ZCL_WARM_STORE"};
const source = (name, value) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.
PUBLIC SECTION.
CLASS-METHODS answer RETURNING VALUE(rv) TYPE i. ENDCLASS.
CLASS ${name} IMPLEMENTATION. METHOD answer. rv = ${value}. ENDMETHOD. ENDCLASS.\n`;
const tests = `CLASS ltcl_probe DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS.
CLASS ltcl_probe IMPLEMENTATION. METHOD check.
cl_abap_unit_assert=>assert_equals( act = zcl_warm_store=>answer( ) exp = 2 ).
ENDMETHOD. ENDCLASS.\n`;

describe("STORE ACTIVATE shares ADT warm publication", function () {
  this.timeout(120000);
  let root, store, destination, child, runtime, publications, failSwap, failRecycle, priorLayers;
  const request = async message => {
    const response = once(child, "message");
    child.send(message);
    const [result] = await response;
    if (result.error) throw new Error(result.error);
    return result;
  };
  const start = async () => {
    child = fork(join(root, "runtime.mjs"), [], {cwd: root, env: {...process.env, OSD_ROOT: root}, stdio: ["ignore", "ignore", "pipe", "ipc"]});
    child.stderr.on("data", data => { if (!String(data).includes("ExperimentalWarning")) process.stderr.write(data); });
    await once(child, "message");
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill(); await exited;
  };
  const execute = async (command, extra = {}) => {
    const result = await withSystem(() => {}, () => destination.execute({IV_COMMAND: command,
      IV_TYPE: target.type, IV_NAME: target.name, ...extra}), {store, repositoryUser: "WARMTEST"});
    expect(result.EV_ERROR ?? "", result.EV_JSON).to.equal("");
    return result;
  };
  const edit = value => execute("WRITE", {IV_SOURCE: source(target.name.toLowerCase(), value)});
  const activate = async () => JSON.parse((await execute("ACTIVATE")).EV_JSON);
  beforeEach(async function () {
    priorLayers = process.env.OSD_LAYERS;
    delete process.env.OSD_LAYERS;
    root = mkdtempSync(join(tmpdir(), "osd-store-warm-"));
    mkdirSync(join(root, "src")); mkdirSync(join(root, "test")); mkdirSync(join(root, ".local/lars"), {recursive: true});
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
    symlinkSync(join(repo, ".local/lars/open-abap-core"), join(root, ".local/lars/open-abap-core"));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "OpenABAP"}}));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], output_folder: "output",
      libs: [{folder: "/.local/lars/open-abap-core", exclude_filter: ["/src/tcp/"]}], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: "compileError",
        setup: {filename: "../test/setup.mjs", preFunction: "setup"}}}));
    writeFileSync(join(root, "test/setup.mjs"), `import {SQLiteDatabaseClient} from '@abaplint/database-sqlite';
export async function setup(abap, schemas, insert) {
 const db = new SQLiteDatabaseClient(); abap.context.databaseConnections.DEFAULT = db;
 await db.connect(); await db.execute(schemas.sqlite); await db.execute(insert);
}`);
    writeFileSync(join(root, "src/zcl_warm_store.clas.abap"), source("zcl_warm_store", 1));
    writeFileSync(join(root, "src/zcl_warm_store.clas.testclasses.abap"), tests);
    writeFileSync(join(root, "src/zcl_unrelated.clas.abap"), source("zcl_unrelated", 10));
    writeFileSync(join(root, "src/zif_warm_store.intf.abap"), "INTERFACE zif_warm_store PUBLIC. ENDINTERFACE.\n");
    writeFileSync(join(root, "runtime.mjs"), `import {pathToFileURL} from 'node:url';
import {HotLoader} from ${JSON.stringify(join(repo, "tools/osd-hot.mjs"))};
await import(pathToFileURL(process.cwd() + '/output/init.mjs'));
const hot = new HotLoader(process.cwd());
process.on('message', async message => {
 try {
  const result = message.method === 'hot' ? await hot.swap(message.swap)
   : {value: (await abap.Classes[message.name ?? 'ZCL_WARM_STORE'].answer()).get(), generation: hot.generation};
  process.send(result);
 } catch (error) {process.send({error: error.message});}
});
process.send({ready: true});`);
    if (this.currentTest.title.includes('first ZIP')) {
      const repoFolder = join(root, 'archive'); mkdirSync(join(repoFolder, 'src'), {recursive: true});
      writeFileSync(join(repoFolder, '.abapgit.xml'), '<STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>FULL</FOLDER_LOGIC>');
      writeFileSync(join(repoFolder, 'src/package.devc.xml'), '<DEVC><DEVCLASS>$ZWARM</DEVCLASS><CTEXT>fixture</CTEXT></DEVC>');
      for (const ext of ['abap', 'testclasses.abap']) {
        const filename = 'zcl_warm_store.clas.' + ext;
        writeFileSync(join(repoFolder, 'src', filename), readFileSync(join(root, 'src', filename)));
        rmSync(join(root, 'src', filename));
      }
      const archive = join(root, 'fixture.zip'); writeFileSync(archive, zipInProcess(repoFolder));
      process.env.OSD_LAYERS = archive;
    }
    store = new ObjectStore({root, libs: [".local/lars/open-abap-core/src"], build: {generators: false}});
    ensureTmp(root);
    writeFileSync(join(root, "local/tmp/tadir.json"), "{}");
    store.create("CLAS", "ZCL_WARM_DRAFT", {package: "$TMP"});
    store.write("CLAS", "ZCL_WARM_DRAFT", source("zcl_warm_draft", "undefined_variable"));
    store.activationJournal = new ActivationJournal(root, {host: "warm-fixture"});
    // Explicitly prime; warm availability must fail the test, never skip it.
    store.warmState = {on: false};
    expect((await store.publish()).ok).to.equal(true);
    await start();
    failSwap = false; failRecycle = false;
    runtime = store.served = {running: true, epoch: 1, generation: liveHash(root), swaps: 0,
      hot: async swap => {
        if (failSwap) throw new Error("injected swap failure");
        const result = await request({method: "hot", swap});
        runtime.generation = swap.generation; runtime.swaps = result.swaps; return result;
      },
      recycle: async () => {
        if (failRecycle) throw new Error("injected recycle failure");
        await stop(); await start(); runtime.generation = liveHash(root); runtime.epoch++;
        return {generation: runtime.generation};
      }, verified: () => {},
    };
    store.warmState = {on: true, compiler: new WarmCompilerProcess({root,
      overlay: set => store.overlay(set), keyOf: file => store.objectKeyOf(file), inactiveSources: set => store.inactiveSources(set)})};
    // Startup can still be priming when the first ZIP save arrives. Prime
    // the saved view directly to exercise the strict live-input rollback
    // proof deterministically, rather than relying on scheduler timing.
    if (this.currentTest.title.includes('first ZIP')) {
      store.write(target.type, target.name, source(target.name.toLowerCase(), 2));
    }
    expect(await store.warmUp(), store.warmState.reason).to.not.equal(undefined);
    destination = new StoreDestination({store}); publications = [];
    const publish = store.publish.bind(store);
    store.publish = async options => {const result = await publish(options); publications.push(result); return result;};
  });
  afterEach(async () => {await closeWarm(store); await store.warmState?.verifying; await stop(); if (root) rmSync(root, {recursive: true, force: true});
    if (priorLayers === undefined) delete process.env.OSD_LAYERS; else process.env.OSD_LAYERS = priorLayers;});

  it("first ZIP STORE WRITE before priming + ACTIVATE stays warm without recycling the serving process", async () => {
    const layers = userLayersOf(root);
    expect(readFileSync(join(root, layers[1].path, 'package.devc.xml'), 'utf8')).to.include('$ZWARM');
    const pid = child.pid;
    await edit(2);
    const operation = await activate();
    expect(operation).to.include({state: 'published', active: true, live: true});
    expect(publications[0]).to.include({ok: true, hot: true, recycled: false});
    expect(publications[0].transpile.warm).to.equal(true);
    expect(child.pid).to.equal(pid); expect(runtime.epoch).to.equal(1);
    expect((await request({method: 'run'})).value).to.equal(2);
    await store.warmState.verifying;
    expect(store.activationJournal.lookup(operation.op_id).verified).to.equal(true);
    expect(child.pid).to.equal(pid); expect(runtime.epoch).to.equal(1);
    expect(readFileSync(join(root, layers[0].path, 'zcl_warm_store.clas.abap'), 'utf8')).to.include('rv = 1.');
  });

  it("publishes an existing edit with warm swap, new serving code, and one status/test generation", async () => {
    await edit(2);
    // The separate full-registry check was STORE's slow path. Warm compilation
    // checks the entire affected closure and keeps the checked revision fence.
    store.activate = () => {throw new Error("separate cold validation was taken");};
    const operation = await activate();
    expect(operation).to.include({state: "published", active: true, live: true, verified: false});
    expect(operation.op_id).to.be.a("string").and.not.equal("");
    expect(publications[0]).to.include({ok: true, hot: true, recycled: false});
    expect(publications[0].transpile.warm).to.equal(true);
    const run = await request({method: "run"});
    expect(run).to.include({value: 2, generation: operation.generation_id});
    const status = JSON.parse((await execute("ACTIVATION_STATUS", {IV_JSON: JSON.stringify({op_id: operation.op_id})})).EV_JSON);
    expect(status.generation_id).to.equal(operation.generation_id);
    const unit = JSON.parse((await execute("RUN_TESTS", {IV_JSON: JSON.stringify({targets: [target], expected_generation: operation.generation_id})})).EV_JSON);
    expect(unit).to.include({state: "ran", generation_id: operation.generation_id, expected_generation: operation.generation_id});
    expect(unit.counts.pass).to.equal(1);
    await store.warmState.verifying;
    expect(JSON.parse((await execute("ACTIVATION_STATUS", {IV_JSON: JSON.stringify({op_id: operation.op_id})})).EV_JSON).verified).to.equal(true);
  });

  it("keeps unrelated inactive edits and never-active drafts out of a warm generation", async () => {
    await execute("WRITE", {IV_NAME: "ZCL_UNRELATED", IV_SOURCE: source("zcl_unrelated", "undefined_variable")});
    await edit(2);
    expect((await activate()).state).to.equal("published");
    expect(publications[0].transpile.warm).to.equal(true);
    expect((await request({method: "run", name: "ZCL_UNRELATED"})).value).to.equal(10);
    expect(readFileSync(join(root, "output/init.mjs"), "utf8")).to.not.include("zcl_warm_draft");
    expect(store.stateOf(store.find("CLAS", "ZCL_WARM_DRAFT")).version).to.equal("inactive");
  });

  for (const change of ["new object", "INTERFACES change"]) it(`falls back to cold for ${change} and publishes`, async () => {
    if (change === "new object") {
      await execute("CREATE", {IV_NAME: "ZCL_NEW_WARM", IV_SOURCE: source("zcl_new_warm", 2)});
    } else await execute("WRITE", {IV_SOURCE: source("zcl_warm_store", 2).replace("PUBLIC SECTION.", "PUBLIC SECTION.\nINTERFACES zif_warm_store.")});
    const operation = JSON.parse((await execute("ACTIVATE", {IV_NAME: change === "new object" ? "ZCL_NEW_WARM" : target.name})).EV_JSON);
    expect(operation).to.include({state: "published", active: true, live: true, verified: true});
    expect(publications[0].transpile.warm).to.not.equal(true);
    expect(publications[0].recycled).to.equal(true);
    expect((await request({method: "run", name: change === "new object" ? "ZCL_NEW_WARM" : target.name})).value).to.equal(2);
  });

  it("recovers a refused warm swap by recycling before published", async () => {
    await edit(2); failSwap = true;
    const operation = await activate();
    expect(operation).to.include({state: "published", active: true, live: true, verified: false});
    expect(publications[0]).to.include({ok: true, recycled: true});
    expect(publications[0].why).to.include("injected swap failure");
    expect((await request({method: "run"})).value).to.equal(2);
  });

  it("fails with a stage when both swap and recycle fail; the draft stays inactive", async () => {
    await edit(2); failSwap = true; failRecycle = true;
    const operation = await activate();
    expect(operation).to.include({state: "failed", failure_stage: "build", active: false, live: false});
    expect(operation.generation_id).to.equal("");
    expect((await request({method: "run"})).value).to.equal(1);
    expect(store.stateOf(store.find(target.type, target.name)).version).to.equal("inactive");
  });

  it("rejects invalid warm code and a revision changed after check without false publication", async () => {
    await edit("undefined_variable");
    expect((await activate()).state).to.equal("failed");
    expect((await request({method: "run"})).value).to.equal(1);
    await edit(2);
    const publish = store.publish;
    store.publish = async options => {await edit(3); return publish(options);};
    const operation = await activate();
    expect(operation).to.include({state: "failed", failure_stage: "revision", active: false});
    expect(operation.generation_id).to.equal("");
  });

  it("keeps checked/pending journal states and after-step scheduling before the warm swap", async () => {
    await edit(2);
    let continuation;
    const pending = await withSystem(() => {}, () => destination.execute({IV_COMMAND: "ACTIVATE", IV_TYPE: target.type, IV_NAME: target.name}),
      {store, deferActivate: work => {continuation = work;}});
    const operation = JSON.parse(pending.EV_JSON);
    expect(operation.state).to.equal("pending"); expect(publications).to.have.length(0);
    expect((await request({method: "run"})).value).to.equal(1);
    expect(JSON.parse((await continuation()).EV_JSON)).to.include({state: "published", op_id: operation.op_id, live: true});
    expect((await request({method: "run"})).value).to.equal(2);
  });
});
