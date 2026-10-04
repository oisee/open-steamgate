import {expect} from "chai";
import express from "express";
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {activeFixture} from "./helpers/source-snapshot.mjs";

const BASE = "/sap/bc/adt";
const LOCKED = "ZCL_ACT_LOCKED";
const FREE = "ZCL_ACT_FREE";
const source = (name, text) => `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS value RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS ${name.toLowerCase()} IMPLEMENTATION.
  METHOD value.
    rv = '${text}'.
  ENDMETHOD.
ENDCLASS.
`;
const uri = name => `${BASE}/oo/classes/${name.toLowerCase()}`;
const references = names => '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
  names.map(name => `<adtcore:objectReference adtcore:uri="${uri(name)}"/>`).join("") + '</adtcore:objectReferences>';

for (const front of ["Node", "ABAP"]) for (const build of [false, true]) {
  describe(`ADT activation respects editing locks (${front}, build=${build})`, function () {
    this.timeout(120000);
    let root, store, server, origin, runtime, a, b, handle, checked, published;

    const request = async (client, path, body) => {
      const res = await fetch(origin + path, {method: "POST", headers: client, body});
      return {status: res.status, type: res.headers.get("content-type"), body: await res.text()};
    };
    const activate = (client, names = [LOCKED], query = "") =>
      request(client, BASE + "/activation?method=activate" + query, references(names));
    const active = name => store.read("CLAS", name, "main", "active").source;
    const login = async () => {
      const res = await fetch(origin + BASE + "/core/discovery", {method: "HEAD", headers: {
        authorization: `Basic ${Buffer.from("SYN_EDITOR:dummy").toString("base64")}`,
        "x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful",
      }});
      expect(res.status).to.equal(200);
      return {cookie: res.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),
        "x-csrf-token": res.headers.get("x-csrf-token"), "x-sap-adt-sessiontype": "stateful",
        "content-type": "application/xml"};
    };
    const unlock = async () => {
      expect((await request(a, uri(LOCKED) + "?_action=UNLOCK&lockHandle=" + encodeURIComponent(handle))).status).to.equal(200);
      handle = undefined;
    };
    const unchanged = () => {
      for (const name of [LOCKED, FREE]) {
        expect(active(name)).to.equal(source(name, "active"));
        expect(store.stateOf(store.find("CLAS", name)).version).to.equal("inactive");
      }
      expect(checked, "syntax/check path ran before the lock refusal").to.equal(0);
      expect(published, "build path ran before the lock refusal").to.equal(0);
    };
    const refused = async (names = [LOCKED], query = "") => {
      const foreignLock = await request(b, uri(LOCKED) + "?_action=LOCK");
      expect(foreignLock.status).to.equal(403);
      expect(foreignLock.body).to.include('id="ExceptionResourceNoAccess"')
        .and.include('<entry key="T100KEY-ID">EU</entry>')
        .and.include('<entry key="T100KEY-NO">510</entry>')
        .and.include('<entry key="T100KEY-V1">SYN_EDITOR</entry>')
        .and.include(`<entry key="T100KEY-V2">${LOCKED}</entry>`)
        .and.include('<entry key="LONGTEXT">');
      expect(await activate(b, names, query)).to.deep.equal(foreignLock);
      unchanged();
    };

    before(async () => {
      root = mkdtempSync(join(tmpdir(), "adt-activation-locks-"));
      mkdirSync(join(root, "src"));
      symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
      writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({global: {files: "/src/**/*.*"},
        syntax: {version: "v702"}, rules: {check_syntax: true}}));
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", output_folder: "output",
        libs: [], options: {ignoreSyntaxCheck: false, addCommonJS: true}}));
      for (const name of [LOCKED, FREE]) writeFileSync(join(root, "src", name.toLowerCase() + ".clas.abap"), source(name, "active"));
      activeFixture(root);
      store = new ObjectStore({root, libs: [], build: {generators: false}});
      let runner;
      if (front === "ABAP") {
        if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
          runtime = new ServingRuntime({root: process.cwd(), watch: false, stdio: "pipe",
            env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
          runtime.storeDestination = new StoreDestination({store});
          await runtime.start();
          runner = abapRunner({remote: runtime});
        } else runner = await adtAbap();
      }
      const app = express();
      app.use(express.raw({type: "*/*"}));
      app.use(adtRouter({store, watch: false, logMisses: false, transpileOnActivate: build, abap: runner}).router);
      server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      origin = `http://127.0.0.1:${server.address().port}`;
      const originalActivate = store.activate.bind(store), originalPublish = store.publish.bind(store);
      store.activate = (...args) => { checked++; return originalActivate(...args); };
      store.publish = (...args) => { published++; return originalPublish(...args); };
    });
    beforeEach(async () => {
      for (const name of [LOCKED, FREE]) {
        store.write("CLAS", name, source(name, "active"));
        store.completeActivation(store.activate("CLAS", name));
      }
      activeFixture(root);
      for (const name of [LOCKED, FREE]) store.write("CLAS", name, source(name, "saved"));
      checked = published = 0;
      a = await login(); b = await login();
      expect(a.cookie).not.to.equal(b.cookie);
      expect(a["x-csrf-token"]).not.to.equal(b["x-csrf-token"]);
      const lock = await request(a, uri(LOCKED) + "?_action=LOCK");
      expect(lock.status, lock.body).to.equal(200);
      handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(lock.body)?.[1];
      expect(handle).to.be.a("string").and.not.equal("");
    });
    afterEach(async () => { if (handle !== undefined) await unlock(); });
    after(async () => {
      if (server) await new Promise(resolve => server.close(resolve));
      await runtime?.stop();
      if (root) rmSync(root, {recursive: true, force: true});
    });

    it("B cannot activate A's locked class; its active source stays unchanged", async () => refused());
    it("forced activation also refuses A's lock before any check or build", async () => refused([LOCKED], "&forced=true"));
    for (const names of [[FREE, LOCKED], [LOCKED, FREE]]) {
      it(`mass activation refuses the whole request (${names.join(", ")})`, async () => refused(names));
    }
    it("A may activate its own locked class and keeps its lock", async () => {
      const answer = await activate(a);
      expect(answer.status, answer.body).to.equal(200);
      expect(answer.body).to.include('activationExecuted="true"');
      if (build) {
        expect(store.stateOf(store.find("CLAS", LOCKED)).version).to.equal("active");
        expect(active(LOCKED)).to.equal(source(LOCKED, "saved"));
      }
      expect(active(FREE)).to.equal(source(FREE, "active"));
      expect((await request(b, uri(LOCKED) + "?_action=LOCK")).status).to.equal(403);
    });
    it("B may activate both objects after A unlocks", async () => {
      await unlock();
      const answer = await activate(b, [FREE, LOCKED]);
      expect(answer.status, answer.body).to.equal(200);
      expect(answer.body).to.include('activationExecuted="true"');
      for (const name of [LOCKED, FREE]) {
        if (build) {
          expect(store.stateOf(store.find("CLAS", name)).version).to.equal("active");
          expect(active(name)).to.equal(source(name, "saved"));
        }
      }
    });
  });
}
