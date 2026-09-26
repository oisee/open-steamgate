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
