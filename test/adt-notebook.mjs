import {expect} from "chai";
import express from "express";
import {adtRouter} from "../tools/adt-facade.mjs";

describe("tools/adt-facade: notebook ABAP cells", () => {
  it("writes to the notebook scratch root, activates, then classruns in order", async () => {
    const events = [];
    const store = {
      roots: [{path: "packs/notebook-scratch/src", pack: "notebook-scratch", writable: true}],
      find: () => undefined,
      write: (...args) => events.push(["write", ...args]),
      warmActivation: (type, name) => {
        events.push(["check", type, name]);
        return {type, name, active: true, revision: "r1"};
      },
      publish: async () => { events.push(["publish"]); return {ok: true}; },
      completeActivation: (checked) => { events.push(["complete", checked]); return true; },
      classrun: async () => ({run: async (name, options) => {
        events.push(["classrun", name, options.data]);
        return {text: "cell output", ok: true, ms: 2, generation: "g"};
      }}),
    };
    const data = {};
    const app = express();
    app.use(adtRouter({store, data, logMisses: false}).router);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });

    try {
      const base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
      const login = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      const token = login.headers.get("x-csrf-token");
      const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")])
        .filter(Boolean).map((value) => value.split(";", 1)[0]).join("; ");
      const source = "CLASS zcl_osd_notebook_cell DEFINITION. ENDCLASS.";
      const res = await fetch(base + "/notebook/abap", {
        method: "POST",
        headers: {"content-type": "application/json", "x-csrf-token": token, cookie},
        body: JSON.stringify({source}),
      });
      expect(res.status).to.equal(200);
      expect(await res.json()).to.deep.equal({text: "cell output", ok: true, ms: 2, generation: "g"});
      expect(events.map(([kind]) => kind)).to.deep.equal(["write", "check", "publish", "complete", "classrun"]);
      expect(events[0].slice(1)).to.deep.equal([
        "CLAS", "ZCL_OSD_NOTEBOOK_CELL", source, "main", {root: "packs/notebook-scratch/src"},
      ]);
      expect(events[3][1]).to.deep.equal({type: "CLAS", name: "ZCL_OSD_NOTEBOOK_CELL", active: true, revision: "r1"});
      expect(events[4].slice(1)).to.deep.equal(["ZCL_OSD_NOTEBOOK_CELL", data]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

const source = `CLASS zcl_portability_test DEFINITION PUBLIC CREATE PUBLIC.
 PUBLIC SECTION.
 INTERFACES if_amdp_marker_hdb.
 CLASS-METHODS run EXPORTING VALUE(ev_result) TYPE i.
ENDCLASS.
CLASS zcl_portability_test IMPLEMENTATION.
 METHOD run BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
 SELECT CAST('x' AS INTEGER) INTO ev_result FROM dummy;
 ENDMETHOD.
ENDCLASS.`;

describe("portable AMDP Check remains advisory", () => {
  it("reports the SQLite refusal as a warning on the SQLScript line and activates", async () => {
    const store = {
      check: () => ({issues: []}), find: () => undefined,
      activate: () => ({type: "CLAS", name: "ZCL_PORTABILITY_TEST", active: true, issues: []}),
      completeActivations: () => true,
    };
    const app = express();
    app.use(adtRouter({store, data: {}, logMisses: false, transpileOnActivate: false}).router);
    const server = await new Promise((resolve) => { const one = app.listen(0, "127.0.0.1", () => resolve(one)); });
    const base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
    const uri = "/sap/bc/adt/oo/classes/zcl_portability_test";
    try {
      const login = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
      const token = login.headers.get("x-csrf-token");
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      const headers = {"x-csrf-token": token, cookie};
      const checked = await fetch(base + "/checkruns", {method: "POST", headers,
        body: `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core"><chkrun:checkObject adtcore:uri="${uri}"><chkrun:artifacts><chkrun:artifact chkrun:uri="${uri}/source/main"><chkrun:content>${source}</chkrun:content></chkrun:artifact></chkrun:artifacts></chkrun:checkObject></chkrun:checkObjectList>`});
      const report = await checked.text();
      expect(report).to.contain('chkrun:type="W"');
      expect(report).to.contain("#start=8,1");
      expect(report).to.contain("CAST to INTEGER cannot raise");
      const scalarSource = source.replace("SELECT CAST('x' AS INTEGER) INTO ev_result FROM dummy;",
        "ev_result = CAST('x' AS INTEGER);");
      const scalarCheck = await fetch(base + "/checkruns", {method: "POST", headers,
        body: `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core"><chkrun:checkObject adtcore:uri="${uri}"><chkrun:artifacts><chkrun:artifact chkrun:uri="${uri}/source/main"><chkrun:content>${scalarSource}</chkrun:content></chkrun:artifact></chkrun:artifacts></chkrun:checkObject></chkrun:checkObjectList>`});
      const scalarReport = await scalarCheck.text();
      expect(scalarReport).to.contain('chkrun:type="W"');
      expect(scalarReport).to.contain("#start=8,1");
      expect(scalarReport).to.contain("CAST to INTEGER cannot raise");
      const activated = await fetch(base + "/activation", {method: "POST", headers,
        body: `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${uri}"/></adtcore:objectReferences>`});
      expect(await activated.text()).to.contain("activationExecuted");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
