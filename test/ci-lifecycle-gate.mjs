import {expect} from "chai";
import {needsLifecycle} from "../tools/osd-ci-lifecycle-gate.mjs";

describe("CI ADT lifecycle gate", () => {
  it("keeps a docs-only change set skipped", () => {
    expect(needsLifecycle(["docs/ci-tests.md", "README.md", "AGENDA.md"])).to.equal(false);
  });

  it("keeps an empty diff skipped", () => {
    expect(needsLifecycle([])).to.equal(false);
  });

  it("runs for ADT source and tooling", () => {
    expect(needsLifecycle(["src/adt/zcl_stg_adt_session.clas.abap"])).to.equal(true);
    expect(needsLifecycle(["src/classrun/zcl_stg_classrun.clas.abap"])).to.equal(true);
    expect(needsLifecycle(["tools/adt-lifecycle.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/adt-session-routes.mjs"])).to.equal(true);
  });

  it("runs for the runtime pieces the lifecycle server executes", () => {
    expect(needsLifecycle(["tools/osd-store.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-store-warm.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-enq-session.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-transpiler.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-unit-run.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-ci-lifecycle-gate.mjs"])).to.equal(true);
  });

  it("runs for lifecycle tests, the binary and the root configuration", () => {
    expect(needsLifecycle(["test/adt-lifecycle-report.mjs"])).to.equal(true);
    expect(needsLifecycle(["test/suites.d/adt.json"])).to.equal(true);
    expect(needsLifecycle(["bin/osd.mjs"])).to.equal(true);
    expect(needsLifecycle(["scripts/build-binary.mjs"])).to.equal(true);
    expect(needsLifecycle(["abap_transpile.json"])).to.equal(true);
    expect(needsLifecycle(["libs.lock.json"])).to.equal(true);
    expect(needsLifecycle(["package.json"])).to.equal(true);
    expect(needsLifecycle(["package-lock.json"])).to.equal(true);
  });

  it("runs for a workflow change", () => {
    expect(needsLifecycle([".github/workflows/tests.yml"])).to.equal(true);
  });

  it("keeps unrelated source changes skipped", () => {
    expect(needsLifecycle(["src/gateway/zcl_stg_dispatcher.clas.abap"])).to.equal(false);
    expect(needsLifecycle(["src/bsp/zcl_stg_bsp_registry.clas.abap"])).to.equal(false);
    expect(needsLifecycle(["webapp/x.js"])).to.equal(false);
    expect(needsLifecycle(["tools/osd-bootstrap.mjs"])).to.equal(false);
  });

  it("runs for a mixed change set", () => {
    expect(needsLifecycle(["docs/x.md", "src/gateway/zcl_stg_dispatcher.clas.abap", "src/adt/zcl_x.clas.abap"])).to.equal(true);
  });
});
