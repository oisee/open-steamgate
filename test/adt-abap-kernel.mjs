// The ADT kernel of the child-mode parent (tools/adt-abap-kernel.mjs): it is
// loaded once, says when the generation's front has moved past it, and
// refuses to be booted over by the whole system.
import {expect} from "chai";
import express from "express";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {closureHash, kernelClosure, kernelFreshness} from "../tools/adt-abap-kernel.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const OUTPUT = resolve("output");

describe("ADT kernel: loaded once, stale said, never booted over", function () {
  this.timeout(60000);

  it("a generation that changes the front is said once per generation, and nothing else is", () => {
    const loaded = closureHash(OUTPUT);
    expect(loaded, "the same generation hashes the same").to.equal(closureHash(OUTPUT));
    // a copy of the generation with one class of the front changed
    const copy = mkdtempSync(join(tmpdir(), "osd-kernel-gen-"));
    try {
      for (const file of readdirSync(OUTPUT)) symlinkSync(join(OUTPUT, file), join(copy, file));
      const changed = "zcl_osd_adt_csrf.clas.mjs";
      expect(kernelClosure(OUTPUT)).to.include(changed);
      rmSync(join(copy, changed));
      writeFileSync(join(copy, changed), readFileSync(join(OUTPUT, changed), "utf8") + "\n// edited\n");
      const said = [];
      let generation = "g1";
      const same = kernelFreshness({output: OUTPUT, loaded, generation: () => generation, log: (line) => said.push(line)});
      expect(same()).to.equal(false);
      const stale = kernelFreshness({output: copy, loaded, generation: () => generation, log: (line) => said.push(line)});
      expect([stale(), stale(), stale()]).to.deep.equal([true, true, true]);
      expect(said, "one line per generation").to.have.length(1);
      expect(said[0]).to.contain("restart the host");
      generation = "g2";
      expect(stale()).to.equal(true);
      expect(said).to.have.length(2);
      // a file outside the front changes nothing
      const other = mkdtempSync(join(tmpdir(), "osd-kernel-gen-"));
      try {
        for (const file of readdirSync(OUTPUT)) symlinkSync(join(OUTPUT, file), join(other, file));
        const outside = readdirSync(OUTPUT).find((f) => f.startsWith("zcl_stg_segw_registry.clas.mjs"));
        rmSync(join(other, outside));
        copyFileSync(join(OUTPUT, outside), join(other, outside));
        writeFileSync(join(other, outside), readFileSync(join(OUTPUT, outside), "utf8") + "\n// elsewhere\n");
        expect(closureHash(other)).to.equal(loaded);
      } finally {
        rmSync(other, {recursive: true, force: true});
      }
    } finally {
      rmSync(copy, {recursive: true, force: true});
    }
  });

  it("a stale front says X-OSD-Front-Stale on every answer, discovery and systeminformation included, and refuses nothing", async () => {
    const {zcl_osd_adt_handler: handler} = await import("../output/zcl_osd_adt_handler.clas.mjs");
    const root = mkdtempSync(join(tmpdir(), "osd-kernel-stale-"));
    let stale = true;
    const app = express();
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, watch: false, logMisses: false,
      abap: abapRunner({handler, step: dialogStep, stale: () => stale})}).router);
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/sap/bc/adt`;
      // what a client asks anyway (the extension's hint reads these): the
      // discovery documents, served by Node, and systeminformation, by ABAP;
      // a refused write carries it too
      const asks = [["GET", "/discovery"], ["HEAD", "/core/discovery"], ["GET", "/core/discovery"],
        ["GET", "/core/http/systeminformation"], ["POST", "/core/http/systeminformation"]];
      for (const [method, path] of asks) {
        const old = await fetch(base + path, {method, headers: {"x-csrf-token": "fetch"}});
        expect([old.status < 500, old.headers.get("x-osd-front-stale")], `${method} ${path}`).to.deep.equal([true, "1"]);
      }
      stale = false;
      for (const [method, path] of asks) {
        expect((await fetch(base + path, {method})).headers.get("x-osd-front-stale"), `${method} ${path}`).to.equal(null);
      }
    } finally {
      await new Promise((r) => server.close(r));
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a process holding the kernel refuses to boot the whole system over it", () => {
    // its own process: the kernel loads only where no ABAP runs yet
    const script = `
      const {loadAdtKernel} = await import(${JSON.stringify(resolve("tools/adt-abap-kernel.mjs"))});
      const setup = await import(${JSON.stringify(resolve("test/setup.mjs"))});
      const {Data} = await import(${JSON.stringify(resolve("tools/osd-data.mjs"))});
      const kernel = await loadAdtKernel({output: ${JSON.stringify(OUTPUT)}, setup});
      const runtime = globalThis.abap;
      let refused;
      try { await new Data({root: process.cwd()}).boot(); } catch (e) { refused = e.message; }
      console.log(JSON.stringify({refused, same: globalThis.abap === runtime, handler: typeof kernel.handler}));
      process.exit(0);`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {encoding: "utf8", timeout: 60000});
    const line = run.stdout.trim().split("\n").pop();
    expect(JSON.parse(line ?? "{}"), run.stderr).to.deep.equal({
      refused: "this process holds the ADT kernel; the system's ABAP runs in the serving child, not here",
      same: true, handler: "function"});
  });
});
