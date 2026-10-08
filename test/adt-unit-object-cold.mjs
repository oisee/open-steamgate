import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {warmUnitPlan, unitPlan} from "../tools/osd-unit.mjs";
import {coldUnitObject} from "./helpers/adt-unit-object-cold.mjs";

describe("ADT unit object immediately after workbench readiness", function () {
  this.timeout(150000);
  it("discovers executable risk on the first GET within one second", async () => {
    const result = await coldUnitObject();
    console.log(`      cold unit object: mode=${result.mode}, ready=${Math.round(result.readyMs)} ms, first=${Math.round(result.firstMs)} ms`);
    expect(result.firstMs, "first unit-object GET after /osd/serving ready:true").to.be.lessThan(1000);
  });
});

describe("ADT unit discovery pre-warm lifecycle", () => {
  it("keeps the warmed parse on first discovery and sees a later source write", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-unit-plan-cold-"));
    const tests = body => `CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS.
      PRIVATE SECTION. METHODS run FOR TESTING. ENDCLASS.
      CLASS ltcl_test IMPLEMENTATION. METHOD run. ${body} ENDMETHOD. ENDCLASS.`;
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
      writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}}));
      writeFileSync(join(root, "src/zcl_cold.clas.abap"),
        "CLASS zcl_cold DEFINITION PUBLIC. ENDCLASS. CLASS zcl_cold IMPLEMENTATION. ENDCLASS.");
      writeFileSync(join(root, "src/zcl_cold.clas.testclasses.abap"), tests(""));
      const store = new ObjectStore({root, libs: []});
      await warmUnitPlan(store);
      const warmed = store.registry();
      const first = await unitPlan(store, "CLAS", "ZCL_COLD", {risk: true});
      expect(first.classes[0].testMethods[0].name).to.equal("RUN");
      expect(first.classes[0].schedule).to.equal("harmless");
      expect(store.registry(), "first find discarded the warmed registry").to.equal(warmed);
      store.write("CLAS", "ZCL_COLD", tests("COMMIT WORK."), "testclasses");
      const changed = await unitPlan(store, "CLAS", "ZCL_COLD", {risk: true});
      expect(changed.writesTotal).to.equal(1);
      expect(changed.writes[0].kind).to.equal("COMMIT WORK");
      expect(changed.classes[0].schedule).to.equal("dangerous");
      expect(store.registry(), "source write updates risk facts in the kept registry").to.equal(warmed);
    } finally {rmSync(root, {recursive: true, force: true});}
  });
});
