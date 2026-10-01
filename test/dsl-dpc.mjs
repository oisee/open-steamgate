// The L1 DPC class is byte-identical with the string generator on every
// project admitted by the MPC bridge, with trace and profile checks.
import {expect} from "chai";
import {readFileSync, readdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {embeddedSource} from "../tools/dsl-dpc-embed.mjs";
import {compile, compileFile} from "../tools/stg-compile.mjs";
import {parseIwpr} from "../tools/segw-gen.mjs";
import {readSpec, tableName} from "../tools/segw-tables.mjs";
import {renderProject} from "../tools/dsl-dpc.mjs";

const FIXTURES = [
  "test/fixtures/segw/zstg_label.iwpr.xml",
  "test/fixtures/segw/zstg_mapped.iwpr.xml",
  "test/fixtures/segw/zstg_mini.iwpr.xml",
  "src/zosd_test/segw/zosd_test.iwpr.xml",
];
function sourceSpecs(dir = "src") {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceSpecs(path) : entry.name.endsWith(".stg.yaml") ? [path] : [];
  });
}
const builtNames = new Set(readdirSync("gen/stg"));
const allCompiled = ["src", "gen/cds", "packs"].flatMap((root) => sourceSpecs(root))
  .filter((path) => builtNames.has(path.split("/").pop().replace(/\.stg\.yaml$/, "")))
  .map((path) => ({path, xml: compileFile(path).iwpr}));
const overlong = allCompiled.filter(({xml}) =>
  parseIwpr(xml).entityTypes.some((type) => type.ABAP_STRUCT?.length > 32));
const compiled = allCompiled.filter((item) => !overlong.includes(item));

describe("DSL L1: full DPC class from typed model", function () {
  this.timeout(120000);
  let abap;
  let count = 0;
  let mutationProject;
  const seen = {opaque: 0, missingRfc: 0, sadl: 0, odc: 0};
  const box = (value) => new abap.types.String().set(value);

  before(async () => {
    await import("./start.mjs");
    abap = globalThis.abap;
    for (const name of ["zcl_osd_dsl_dpc_templates", "zcl_osd_dsl_dpc", "zcl_stg_segw_gen",
      "zcl_stg_segw_gen_dpc", "zcl_osd_tpl", "zcl_osd_dsl_trace", "zcl_osd_dsl_profile",
      "zcl_stg_dispatcher", "zcl_ajson"]) await import(`../output/${name}.clas.mjs`);
  });

  after(async () => {
    const db = abap.context.databaseConnections.DEFAULT;
    for (const tag of Object.keys(readSpec())) {
      await db.execute(`DELETE FROM ${tableName(tag).toLowerCase()} WHERE project LIKE 'ZUTDPC%'`);
    }
  });

  async function imported(path, suppliedXml) {
    const project = `ZUTDPC${++count}`;
    const xml = (suppliedXml ?? readFileSync(path, "utf8"))
      .replace(/<PROJECT>[^<]+<\/PROJECT>/g, `<PROJECT>${project}</PROJECT>`);
    const response = await abap.Classes.ZCL_STG_DISPATCHER.dispatch({
      iv_method: box("POST"),
      iv_path: box("/sap/opu/odata/sap/ZSTG_SEGW_SRV/ImportSet"),
      iv_body: box(JSON.stringify({Content: xml})),
    });
    const status = response.get().status.get();
    expect([200, 201], `${path}: ${response.get().body.get().slice(0, 300)}`).to.include(status);
    return abap.Classes.ZCL_STG_SEGW_GEN.build_model({iv_project: box(project)});
  }

  it("keeps the same documented SEGW width exclusion as the MPC bridge", () => {
    expect(overlong.map(({path}) => path).sort()).to.deep.equal([
      "gen/cds/zc_osd_taxicube_cds.stg.yaml",
      "gen/cds/zc_stg_flightcube_cds.stg.yaml",
      "gen/cds/zc_stg_travelcube_cds.stg.yaml",
    ]);
  });

  it("keeps the ABAP embedded templates in sync with their sources", () => {
    expect(readFileSync("src/dsl/zcl_osd_dsl_dpc_templates.clas.abap", "utf8")).to.equal(embeddedSource());
  });

  const demoXml = compileFile("src/demo/zstg_demo.stg.yaml").iwpr;
  const complexXml = compile(`
project: ZSTG_CT
service: ZSTG_CT_SRV
complexTypes:
  Address:
    properties:
      Street: String(40)
      City: String(40)
  Money:
    source: {struct: ZSTG_MONEY}
    properties:
      Amount: Decimal(15,2)
      Currency: String(5)
entities:
  Customer:
    keys: [CustomerId]
    properties:
      CustomerId: String(10)
      Address: Address
functions:
  Quote:
    method: GET
    returns: {complexType: Money}
    parameters:
      CustomerId: String(10)
`, {file: "zstg_ct.stg.yaml"}).iwpr;
  const projects = [
    ...FIXTURES.map((path) => ({path})),
    {path: "compiled demo", xml: demoXml},
    {path: "compiled complex", xml: complexXml},
    ...compiled,
  ];

  for (const {path, xml} of projects) {
    it(`compares ${path}`, async () => {
      const model = await imported(path, xml);
      if (path === "src/zosd_test/segw/zosd_test.iwpr.xml") mutationProject = model;
      const expected = (await abap.Classes.ZCL_STG_SEGW_GEN_DPC.dpc_source({is_model: model})).get();
      const shape = JSON.parse((await abap.Classes.ZCL_OSD_DSL_DPC.project_model_json({is_model: model})).get());
      seen.opaque += shape.impls.filter((impl) => impl.opaque).length;
      seen.missingRfc += shape.impls.filter((impl) => impl.missing_rfc).length;
      seen.sadl += shape.impls.filter((impl) => impl.sadl_get_dpc).length;
      seen.odc += shape.impls.filter((impl) => impl.odc_q || impl.odc_r).length;
      const data = await abap.Classes.ZCL_OSD_DSL_DPC.project_model({is_model: model});
      const result = await abap.Classes.ZCL_OSD_DSL_DPC.render_class({is_model: model});
      const actual = (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get();
      const mismatch = [...actual].findIndex((ch, i) => ch !== expected[i]);
      expect(actual, `${path} at byte ${mismatch}: ${JSON.stringify(actual.slice(mismatch, mismatch + 100))}`).to.equal(expected);
      const traces = result.get().trace.array();
      const lines = result.get().lines.array();
      expect(traces.length, `${path} trace count`).to.equal(lines.length);
      const sidecar = JSON.parse((await abap.Classes.ZCL_OSD_DSL_TRACE.sidecar({
        iv_generator: box("dsl-dpc"), iv_template: box("dpc_class"), io_model: data, is_result: result,
      })).get());
      expect(sidecar.lines.length).to.equal(lines.length);
      expect(sidecar.lines.every((line) => line.node && line.path && line.template_line > 0),
        `${path} trace nodes`).to.equal(true);
      const findings = (await abap.Classes.ZCL_OSD_DSL_PROFILE.check({
        iv_profile: box("abap"), iv_strict: box(""), is_result: result, io_model: data,
      })).array();
      expect(findings.filter((f) => f.get().severity.get() === "E"), `${path} ABAP profile`).to.deep.equal([]);
      console.log(`${path}: ${lines.length} DPC lines`);
    });
  }

  it("the corpus reaches mapped, SADL and ODC branches", () => {
    expect(seen.opaque).to.be.greaterThan(0);
    expect(seen.missingRfc).to.be.greaterThan(0);
    expect(seen.sadl).to.be.greaterThan(0);
    expect(seen.odc).to.be.greaterThan(0);
  });

  it("mutations change only lines traced to their model node", async () => {
    const json = JSON.parse((await abap.Classes.ZCL_OSD_DSL_DPC.project_model_json({is_model: mutationProject})).get());
    const parse = (value) => abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(value))});
    const baseModel = await parse(json);
    const base = await abap.Classes.ZCL_OSD_DSL_DPC.render_model({io_model: baseModel});
    const baseLines = base.get().lines.array().map((line) => line.get());
    const sidecar = JSON.parse((await abap.Classes.ZCL_OSD_DSL_TRACE.sidecar({
      iv_generator: box("dsl-dpc"), iv_template: box("dpc_class"), io_model: baseModel, is_result: base,
    })).get());
    const changes = [
      {node: json["@id"], edit: (data) => { data.generated_on = "02.10.2026"; }},
      {node: json.declarations[0]["@id"], edit: (data) => { data.declarations[0].method += "_ALT"; }},
      {node: json.sadl_sources[0]["@id"], edit: (data) => { data.sadl_sources[0].binding += "_ALT"; }},
      {node: json.sadl_structures[0].properties[0]["@id"],
        edit: (data) => { data.sadl_structures[0].properties[0].abap_field += "_ALT"; }},
    ];
    for (const {node, edit} of changes) {
      const changed = structuredClone(json);
      edit(changed);
      const result = await abap.Classes.ZCL_OSD_DSL_DPC.render_model({io_model: await parse(changed)});
      const lines = result.get().lines.array().map((line) => line.get());
      expect(lines.length, `${node} line count`).to.equal(baseLines.length);
      const indices = lines.flatMap((line, i) => line !== baseLines[i] ? [i] : []);
      expect(indices.length, `${node} changed lines`).to.be.greaterThan(0);
      expect(indices.every((i) => sidecar.lines[i].node === node), `${node} changed only own lines`).to.equal(true);
      expect(sidecar.lines.filter((line) => line.node === node).length, `${node} has traced lines`).to.be.greaterThan(0);
    }
  });

  it("the render command writes the DPC source and complete trace sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsl-dpc-"));
    try {
      const {abapFile, traceFile, findings} = await renderProject(FIXTURES[2], dir, {project: "ZUTDPCCLI"});
      const source = readFileSync(abapFile, "utf8");
      const trace = JSON.parse(readFileSync(traceFile, "utf8"));
      expect(source).to.include("/IWBEP/CL_MGW_PUSH_ABS_DATA");
      expect(trace.generator).to.equal("dsl-dpc");
      expect(trace.lines.length).to.equal(source.trimEnd().split("\n").length);
      expect(trace.lines.every((line) => line.node)).to.equal(true);
      expect(findings.filter((finding) => finding.severity === "E")).to.deep.equal([]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
