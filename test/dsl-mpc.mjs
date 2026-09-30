// DSL L1, first consumer (docs/dsl-l1.md): the DEFINE_<entity> method of an
// _MPC class rendered from the L1 model through ZCL_OSD_TPL must equal, byte
// for byte, what zcl_stg_segw_gen writes -- for every entity type of every
// SEGW project the tree carries as a fixture. ABAP Unit cannot read these
// files, so they are imported here through ImportSet, as the editor does.
import {expect} from "chai";
import {readFileSync} from "node:fs";

const FIXTURES = [
  "test/fixtures/segw/zstg_label.iwpr.xml",
  "test/fixtures/segw/zstg_mapped.iwpr.xml",
  "test/fixtures/segw/zstg_mini.iwpr.xml",
  "src/zosd_test/segw/zosd_test.iwpr.xml",
];

describe("DSL L1: MPC entity methods from the model, byte for byte", function () {
  this.timeout(120000);
  let abap;
  const box = (value) => new abap.types.String().set(value);

  before(async () => {
    await import("./start.mjs");
    abap = globalThis.abap;
    await import("../output/zcl_osd_dsl_mpc.clas.mjs");
    await import("../output/zcl_stg_segw_gen.clas.mjs");
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_stg_dispatcher.clas.mjs");
  });

  async function importProject(path) {
    const xml = readFileSync(path, "utf8");
    const response = await abap.Classes.ZCL_STG_DISPATCHER.dispatch({
      iv_method: box("POST"),
      iv_path: box("/sap/opu/odata/sap/ZSTG_SEGW_SRV/ImportSet"),
      iv_body: box(JSON.stringify({Content: xml})),
    });
    const status = response.get().status.get();
    expect([200, 201], `${path}: ${response.get().body.get().slice(0, 300)}`).to.include(status);
    return /<PROJECT>([^<]+)<\/PROJECT>/.exec(xml)[1];
  }

  // No fixture file has a property with semantics, a complex property or a
  // media entity (the files are shared with the SEGW generator tests and stay
  // as they are); zcl_osd_dsl_mpc's ABAP Unit test imports a project with all
  // three and compares those methods byte for byte too
  const seen = {creatable: 0, updatable: 0, sortable: 0, key: 0, label: 0, sets: 0};

  for (const path of FIXTURES) {
    it(`every entity type of ${path.split("/").pop()}`, async () => {
      const project = await importProject(path);
      const model = await abap.Classes.ZCL_STG_SEGW_GEN.build_model({iv_project: box(project)});
      const source = (await abap.Classes.ZCL_STG_SEGW_GEN.mpc_source({is_model: model})).get();
      const types = model.get().entity_types.array();
      expect(types.length, `${project} has entity types`).to.be.greaterThan(0);
      for (const type of types) {
        const stem = type.get().define_stem.get();
        const start = source.indexOf(`  method DEFINE_${stem}.\n`);
        expect(start, `DEFINE_${stem} in the generated source`).to.be.at.least(0);
        const end = source.indexOf("  endmethod.\n", start) + "  endmethod.\n".length;
        const expected = source.slice(start, end);
        const result = await abap.Classes.ZCL_OSD_DSL_MPC.render_entity({is_type: type, iv_mpc: model.get().mpc});
        const actual = (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get();
        expect(actual, `${project} ${type.get().name.get()}`).to.equal(expected);
        for (const [what, needle] of Object.entries({
          creatable: "set_creatable( abap_true )", updatable: "set_updatable( abap_true )",
          sortable: "set_sortable( abap_true )", key: "set_is_key( )", label: "set_label_from_text_element(",
          sets: "create_entity_set(",
        })) if (expected.includes(needle)) seen[what]++;
      }
    });
  }

  // The byte comparison only covers what the fixtures exercise; this names it,
  // so a fixture that loses a case fails here rather than going quiet.
  it("the fixtures together exercise every optional line", () => {
    expect(Object.keys(seen).filter((what) => seen[what] === 0), "optional lines no fixture reaches").to.deep.equal([]);
  });
});
