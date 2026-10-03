import {expect} from "chai";
import {execFileSync, spawn} from "node:child_process";
import {exceptionDocument} from "../tools/adt-documents.mjs";

describe("ADT preview backend wiring", function () {
  this.timeout(120000);
  it("passes POST XML intact, defaults empty content type and retains continuation refusal bytes", async () => {
    execFileSync(process.execPath, ["scripts/build-preview.mjs"], {
      env: {...process.env, OSD_PREVIEW_GENERATE_ONLY: "1"}, stdio: "pipe",
    });
    const source = `
      const backend = await import("./web/preview-backend.mjs");
      await backend.startBackend();
      await import("./output/zcl_osd_adt_route_f3.clas.mjs");
      const a = globalThis.abap;
      const routes = a.Classes.ZCL_OSD_ADT_ROUTER.METHODS.DISPATCH.parameters.IT_ROUTES.type();
      await a.Classes.ZCL_OSD_ADT_ROUTER.add({iv_method: new a.types.String().set("*"),
        iv_pattern: new a.types.String().set("/sap/bc/adt/f3"),
        iv_handler: new a.types.String().set("ZCL_OSD_ADT_ROUTE_F3"),
        iv_resume_kind: new a.types.String().set("f3-write"), ct_routes: routes});
      await a.Classes.ZCL_OSD_ADT_HANDLER.use_routes({it_routes: routes});
      const answers = [];
      for (const method of ["POST", "GET"]) {
        const answer = await backend.handleRequest({method, path: "/sap/bc/adt/f3",
          body: new TextEncoder().encode('<?xml version="1.0"?><body>café &amp; test</body>')});
        answers.push({status: answer.status, contentType: answer.headers.get("content-type"),
          body: new TextDecoder().decode(answer.body)});
      }
      // Inject the internal miss marker alongside a normal response header
      // into a real ABAP answer, then use the handler's wire filtering.
      const {previewAdtAnswer} = await import("./web/preview-continuations.mjs");
      const {dialogStep} = await import("./tools/osd-dialog-step.mjs");
      const handler = a.Classes.ZCL_OSD_ADT_HANDLER;
      const markedHandler = {METHODS: handler.METHODS,
        wire_headers: (params) => handler.wire_headers(params),
        answer: async (params) => {
          await handler.answer(params);
          const headers = params.es_response.get().headers;
          for (const [name, value] of [["X-OSD-Miss", "resource"], ["X-F3-Keep", "retained"]]) {
            const row = headers.appendInitial().get(); row.name.set(name); row.value.set(value);
          }
        }};
      const miss = await dialogStep(() => previewAdtAnswer(markedHandler, {
        method: "POST", path: "/sap/bc/adt/f3"}), "preview miss");
      answers.push({status: miss.status, miss: miss.headers.get("x-osd-miss"),
        kept: miss.headers.get("x-f3-keep"), contentType: miss.headers.get("content-type")});
      process.send(answers);
      process.exit(0);
    `;
    const answers = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
        stdio: ["ignore", "ignore", "pipe", "ipc"], env: process.env,
      });
      const timer = setTimeout(() => child.kill(), 90000);
      let result, stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("message", (message) => { result = message; });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && result !== undefined) resolve(result);
        else reject(new Error(`preview exited ${code}: ${stderr}`));
      });
    });
    expect(answers[0]).to.deep.equal({status: 200, contentType: "text/html",
      body: '<?xml version="1.0"?><body>café &amp; test</body>'});
    expect(answers[1]).to.deep.equal({status: 500, contentType: "application/xml; charset=utf-8",
      body: exceptionDocument("ExceptionInternalError", 'ZCL_OSD_ADT_HANDLER: no continuation "f3-write" is registered on this host', {namespace: "org.open-steamgate.osd"})});
    expect(answers[2]).to.deep.equal({status: 200, miss: null, kept: "retained", contentType: "text/html"});
  });
});
