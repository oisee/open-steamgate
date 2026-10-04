import {expect} from "chai";
import express from "express";
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {ObjectStore, TYPES} from "../tools/osd-store.mjs";
import {activationReferencesIn, objectFromUri, exceptionDocument} from "../tools/adt-documents.mjs";
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
  names.map(name => `<adtcore:objectReference adtcore:uri="${name.startsWith(BASE + "/") ? name : uri(name)}"/>`).join("") + '</adtcore:objectReferences>';
const otherObjects = [
  {type: "INTF", name: "ZIF_ACT_LOCKED", path: `${BASE}/oo/interfaces/zif_act_locked`, file: "zif_act_locked.intf.abap",
    source: text => `INTERFACE zif_act_locked PUBLIC.\n" ${text}\nENDINTERFACE.\n`, suffix: "/includes/main/source/main"},
  {type: "INCL", name: "ZACT_LOCKED_INC", path: `${BASE}/programs/includes/zact_locked_inc`, file: "zact_locked_inc.prog.abap",
    source: text => `FORM demo.\n  WRITE '${text}'.\nENDFORM.\n`, suffix: "/source/main"},
];

describe("ADT activation reference identities", () => {
  const collections = Object.entries(TYPES).filter(([, meta]) => meta.adt).map(([type, meta]) => [type, meta.adt]);
  for (const [path, type, name] of [
    ["oo/classes/zcl_demo/includes/implementations/source/main", "CLAS", "ZCL_DEMO"],
    ["oo/classes/%2Fdemo%2Fzcl_demo/includes/testclasses", "CLAS", "/DEMO/ZCL_DEMO"],
    ["oo/interfaces/zif_demo/includes/main/source/main", "INTF", "ZIF_DEMO"],
    ["functions/groups/zfg_demo/includes/lzfg_demotop/source/main", "FUGR", "ZFG_DEMO"],
    ["functions/groups/zfg_demo/fmodules/z_demo/source/main", "FUGR", "ZFG_DEMO"],
    ["programs/includes/zdemo_inc/source/main", "INCL", "ZDEMO_INC"],
    ["programs/programs/zdemo/source/main", "PROG", "ZDEMO"],
  ]) it(path, () => {
    expect(objectFromUri(`${BASE}/${path}?version=inactive#start=1,1`, collections, {owningObject: true})).to.deep.equal({type, name});
  });
  it("retains unsupported, malformed and missing-URI references for activation preflight", () => {
    const supported = [["CLAS", "oo/classes"]];
    const body = references([FREE, BASE + "/functions/groups/zact_group", BASE + "/oo/classes/%ZZ"])
      .replace("</adtcore:objectReferences>", '<adtcore:objectReference adtcore:name="MISSING_URI"/></adtcore:objectReferences>');
    expect(activationReferencesIn(body, supported)).to.deep.equal([
      {type: "CLAS", name: FREE, uri: uri(FREE), supported: true},
      {type: "FUGR", name: "ZACT_GROUP", uri: BASE + "/functions/groups/zact_group", supported: false},
      {name: BASE + "/oo/classes/%ZZ", uri: BASE + "/oo/classes/%ZZ", supported: false},
      {name: "MISSING_URI", uri: "", supported: false},
    ]);
  });
});

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
      expect(store.read("CLAS", LOCKED, "implementations", "active").source).to.equal('" active include\n');
      expect(checked, "syntax/check path ran before the preflight refusal").to.equal(0);
      expect(published, "build path ran before the preflight refusal").to.equal(0);
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
      writeFileSync(join(root, "src", LOCKED.toLowerCase() + ".clas.locals_imp.abap"), '" active include\n');
      for (const object of otherObjects) writeFileSync(join(root, "src", object.file), object.source("active"));
      writeFileSync(join(root, "src", "zact_locked_inc.prog.xml"), "<abapGit><PROGDIR><NAME>ZACT_LOCKED_INC</NAME><SUBC>I</SUBC></PROGDIR></abapGit>");
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
      store.write("CLAS", LOCKED, '" active include\n', "implementations");
      for (const name of [LOCKED, FREE]) {
        store.write("CLAS", name, source(name, "active"));
        store.completeActivation(store.activate("CLAS", name));
      }
      for (const object of otherObjects) {
        store.write(object.type, object.name, object.source("active"));
        store.completeActivation(store.activate(object.type, object.name));
      }
      activeFixture(root);
      for (const name of [LOCKED, FREE]) store.write("CLAS", name, source(name, "saved"));
      store.write("CLAS", LOCKED, '" saved include\n', "implementations");
      for (const object of otherObjects) store.write(object.type, object.name, object.source("saved"));
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
    for (const suffix of ["/includes/implementations", "/includes/implementations/source/main", "/includes/testclasses/source/main?version=inactive#start=1,1"]) {
      it(`B cannot activate A's class via ${suffix}`, async () => refused([uri(LOCKED) + suffix]));
    }
    it("a free class before a foreign-locked include activates nothing", async () => refused([FREE, uri(LOCKED) + "/includes/implementations/source/main"]));
    it("forced include activation still respects A's lock", async () => refused([uri(LOCKED) + "/includes/implementations/source/main"], "&forced=true"));
    for (const object of otherObjects) it(`${object.type} reference uses its own LOCK identity for refusal and activation`, async () => {
      const lock = await request(a, object.path + "?_action=LOCK");
      expect(lock.status, lock.body).to.equal(200);
      const ownHandle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(lock.body)?.[1];
      expect(ownHandle).to.be.a("string");
      try {
        const foreign = await request(b, object.path + "?_action=LOCK");
        expect(foreign.status).to.equal(403);
        expect(foreign.body).to.include('<entry key="T100KEY-ID">EU</entry>')
          .and.include('<entry key="T100KEY-NO">510</entry>')
          .and.include(`<entry key="T100KEY-V2">${object.name}</entry>`);
        expect(await activate(b, [object.path + object.suffix])).to.deep.equal(foreign);
        unchanged();
        expect(store.read(object.type, object.name, "main", "active").source).to.equal(object.source("active"));
        expect(store.stateOf(store.find(object.type, object.name)).version).to.equal("inactive");
        const answer = await activate(a, [object.path + object.suffix]);
        expect(answer.status, answer.body).to.equal(200);
        expect(answer.body).to.include('activationExecuted="true"');
        if (build) {
          expect(store.read(object.type, object.name, "main", "active").source).to.equal(object.source("saved"));
          expect(store.stateOf(store.find(object.type, object.name)).version).to.equal("active");
        }
        expect((await request(b, object.path + "?_action=LOCK")).status).to.equal(403);
      } finally {
        expect((await request(a, object.path + "?_action=UNLOCK&lockHandle=" + encodeURIComponent(ownHandle))).status).to.equal(200);
      }
    });
    for (const suffix of ["", "/includes/lzacttop/source/main", "/fmodules/z_act_demo/source/main"]) {
      it(`function group ${suffix} remains unsupported by LOCK and activation`, async () => {
        const path = BASE + "/functions/groups/zact_group";
        expect((await request(a, path + "?_action=LOCK")).status).to.equal(404);
        const answer = await activate(a, [path + suffix]);
        expect(answer.status, answer.body).to.equal(400);
        expect(answer.body).to.equal(exceptionDocument("ExceptionInvalidRequest", "no object references in the request"));
        unchanged();
      });
    }
    it("forced mixed activation cannot discard a function group", async () => {
      const path = BASE + "/functions/groups/zact_group";
      const answer = await activate(a, [FREE, path], "&forced=true");
      expect(answer.status, answer.body).to.equal(200);
      expect(answer.body).to.include('<chkl:properties checkExecuted="false" activationExecuted="false" generationExecuted="false"/>')
        .and.include('objDescr="ZACT_GROUP" type="E"').and.include(`href="${path}"`);
      unchanged();
    });
    for (const path of [BASE + "/unsupported/zact_unknown", BASE + "/oo/classes/%ZZ", BASE + "/oo/classes/", uri("ZCL_ACT_MISSING")]) {
      it(`an unresolvable reference activates nothing: ${path}`, async () => {
        const answer = await activate(a, [FREE, path]);
        expect(answer.status, answer.body).to.equal(200);
        expect(answer.body).to.include('<chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/>')
          .and.include('type="E"').and.include(`href="${path}"`);
        unchanged();
      });
    }
    it("a reference with no URI cannot silently disappear from a mixed request", async () => {
      const body = references([FREE]).replace("</adtcore:objectReferences>", '<adtcore:objectReference adtcore:name="MISSING_URI"/></adtcore:objectReferences>');
      const answer = await request(a, BASE + "/activation?method=activate", body);
      expect(answer.status, answer.body).to.equal(200);
      expect(answer.body).to.include('activationExecuted="false"').and.include('generationExecuted="false"')
        .and.include('objDescr="MISSING_URI" type="E"').and.include('href=""');
      unchanged();
    });
    for (const suffix of ["", "/includes/lzacttop/source/main", "/fmodules/z_act_demo/source/main"]) {
      for (const reversed of [false, true]) it(`mixed function group ${suffix} refuses the entire activation (reversed=${reversed})`, async () => {
        const path = BASE + "/functions/groups/zact_group" + suffix;
        const names = reversed ? [path, FREE] : [FREE, path];
        const answer = await activate(a, names);
        expect(answer.status, answer.body).to.equal(200);
        expect(answer.body).to.include('<chkl:properties checkExecuted="true" activationExecuted="false" generationExecuted="false"/>')
          .and.include('objDescr="ZACT_GROUP" type="E"')
          .and.include(`href="${path}"`)
          .and.include("unsupported");
        unchanged();
      });
    }
    it("forced activation also refuses A's lock before any check or build", async () => refused([LOCKED], "&forced=true"));
    for (const names of [[FREE, LOCKED], [LOCKED, FREE]]) {
      it(`mass activation refuses the whole request (${names.join(", ")})`, async () => refused(names));
    }
    for (const reference of [LOCKED, uri(LOCKED) + "/includes/implementations/source/main"]) it(`A may activate its own locked class via ${reference} and keeps its lock`, async () => {
      const answer = await activate(a, [reference]);
      expect(answer.status, answer.body).to.equal(200);
      expect(answer.body).to.include('activationExecuted="true"');
      if (build) {
        expect(store.stateOf(store.find("CLAS", LOCKED)).version).to.equal("active");
        expect(active(LOCKED)).to.equal(source(LOCKED, "saved"));
        expect(store.read("CLAS", LOCKED, "implementations", "active").source).to.equal('" saved include\n');
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
