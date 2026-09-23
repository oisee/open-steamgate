import {expect} from "chai";
import {readFileSync} from "node:fs";
import {generate} from "../tools/segw-gen.mjs";
import {loadFunctionGroups} from "../tools/segw-gen-mapping.mjs";

// The generator is tested for real against the corpus in .local (the
// classes SEGW made from the same IWPR must come out identical); this
// fixture keeps the shape under test in the repository.
describe("tools/segw-gen: IWPR -> _MPC/_DPC as SEGW writes them", () => {
  const {model, files, ext} = generate(readFileSync("test/fixtures/segw/zstg_mini.iwpr.xml", "utf8"));

  it("reads the project tree", () => {
    expect(model.project).to.equal("ZSTG_MINI");
    expect(model.namespace).to.equal("ZSTG_MINI_SRV");
    expect(model.classes).to.deep.equal({mpc: "ZCL_ZSTG_MINI_MPC", mpcExt: "ZCL_ZSTG_MINI_MPC_EXT", dpc: "ZCL_ZSTG_MINI_DPC", dpcExt: "ZCL_ZSTG_MINI_DPC_EXT"});
    const travel = model.entityTypes[0];
    expect(travel.properties.map((p) => p.name)).to.deep.equal(["TravelId", "Seats"]);
    expect(travel.properties[0]).to.include({isKey: true, filterable: true, creatable: false});
    expect(travel.entitySets[0]).to.include({name: "TravelSet", creatable: false, pageable: true, addressable: true, searchable: true});
    expect(travel.entitySets[0].operations.map((o) => o.method)).to.deep.equal(["TRAVELSET_GET_ENTITYSET", "TRAVELSET_GET_ENTITY"]);
  });

  it("writes the model provider base class", () => {
    const mpc = files["zcl_zstg_mini_mpc.clas.abap"];
    expect(mpc).to.contain("class ZCL_ZSTG_MINI_MPC definition");
    expect(mpc).to.contain("     TS_TRAVEL type ZSTG_DEMO .");
    expect(mpc).to.contain("model->set_schema_namespace( 'ZSTG_MINI_SRV' ).");
    expect(mpc).to.contain("lo_entity_type = model->create_entity_type( iv_entity_type_name = 'Travel' iv_def_entity_set = abap_false ). \"#EC NOTEXT");
    expect(mpc).to.contain("lo_property = lo_entity_type->create_property( iv_property_name = 'TravelId' iv_abap_fieldname = 'TRAVEL_ID' ). \"#EC NOTEXT\nlo_property->set_is_key( ).\nlo_property->set_type_edm_string( ).\nlo_property->set_maxlength( iv_max_length = 8 ). \"#EC NOTEXT");
    expect(mpc).to.contain("lo_property->set_type_edm_int32( ).");
    expect(mpc).to.contain("lo_entity_set->set_has_ftxt_search( abap_true ).");
    expect(mpc).to.contain("VALUE '20260912200000'");
    expect(files["zcl_zstg_mini_mpc.clas.xml"]).to.contain("<CMPNAME>DEFINE_TRAVEL</CMPNAME>");
  });

  it("writes the data provider base class with the dispatch and the stubs", () => {
    const dpc = files["zcl_zstg_mini_dpc.clas.abap"];
    expect(dpc).to.contain("  methods /IWBEP/IF_MGW_APPL_SRV_RUNTIME~GET_ENTITYSET\n    redefinition .");
    expect(dpc).not.to.contain("~CREATE_ENTITY\n    redefinition");
    expect(dpc).to.contain("  methods TRAVELSET_GET_ENTITYSET\n    importing");
    expect(dpc).to.contain("      !ET_ENTITYSET type ZCL_ZSTG_MINI_MPC=>TT_TRAVEL");
    expect(dpc).to.contain("   WHEN 'TravelSet'.\n*     Call the entity set generated method\n      travelset_get_entityset(");
    expect(dpc).to.contain("      method = 'TRAVELSET_GET_ENTITY'.");
    expect(files["zcl_zstg_mini_dpc.clas.xml"]).to.contain("<DESCRIPT>Related EntitySet Name: TravelSet</DESCRIPT>");
  });

  it("writes empty _EXT classes for SEGW to never touch again", () => {
    expect(ext["zcl_zstg_mini_dpc_ext.clas.abap"]).to.contain("inheriting from ZCL_ZSTG_MINI_DPC");
    expect(ext["zcl_zstg_mini_mpc_ext.clas.xml"]).to.contain("<CLSNAME>ZCL_ZSTG_MINI_MPC_EXT</CLSNAME>");
  });
});

// Operations mapped to a data source: SEGW writes the RFC call or the
// search-help call into the base class; the fixture maps TravelSet to two
// function modules from test/fixtures/segw/zstg_rfc.fugr.xml and StatusVHSet
// to a search help. The shape is the one of EPM-RFC-SAMPLE-2 and
// /IWBEP/GWSAMPLE_BASIC (documented on help.sap.com, link in docs/segw-mapping.md).
describe("tools/segw-gen: operations mapped to function modules and search helps", () => {
  const warnings = [];
  const {model, files} = generate(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"), {
    functionModules: loadFunctionGroups(["test/fixtures/segw"]), warnings,
  });
  const dpc = files["zcl_zstg_mapped_dpc.clas.abap"];
  const method = (name) => {
    const at = dpc.indexOf(`  method ${name}.`);
    return dpc.slice(at, dpc.indexOf("  endmethod.", at));
  };

  it("reads the mapping rows of the tree", () => {
    const [travel, statusVh] = model.entityTypes;
    const read = travel.entitySets[0].operations.find((o) => o.type === "R").mapping;
    expect(read).to.include({kind: "RFC", functionName: "Z_STG_TRAVEL_GET", logAttr: "ET_RETURN"});
    expect(read.props.map((p) => `${p.direction} ${p.property} ${p.dsAttPath}`)).to.deep.equal(["I TravelId IV_TRAVEL_ID", "O TravelId ES_TRAVEL\\TRAVEL_ID", "O Seats ES_TRAVEL\\SEATS"]);
    const query = travel.entitySets[0].operations.find((o) => o.type === "Q").mapping;
    expect(query.ranges.map((r) => r.semantics).sort()).to.deep.equal(["H", "L", "O", "S"]);
    expect(query.props.find((p) => p.constant)).to.include({constant: "'X'", dsAttPath: "IV_WITH_TEXTS"});
    expect(statusVh.entitySets[0].operations[0].mapping).to.include({kind: "SHLP", shlpName: "ZSTG_STATUS_SH"});
    expect(warnings).to.deep.equal([]);
  });

  it("reads the function module signatures from the abapGit function group", () => {
    const fms = loadFunctionGroups(["test/fixtures/segw"]);
    expect([...fms.keys()]).to.deep.equal(["Z_STG_TRAVEL_GET", "Z_STG_TRAVEL_LIST"]);
    expect(fms.get("Z_STG_TRAVEL_LIST").importing.map((p) => `${p.name}:${p.type}${p.optional ? "?" : ""}`)).to.deep.equal(["IT_TRAVEL_ID_RANGE:ZSTG_TRAVEL_ID_RANGE_T?", "IV_WITH_TEXTS:FLAG?"]);
    expect(fms.get("Z_STG_TRAVEL_GET").exporting.map((p) => p.name)).to.deep.equal(["ES_TRAVEL", "ET_RETURN"]);
  });

  it("writes the RFC read: keys in, destination, local or remote call, log, outputs mapped back", () => {
    const m = method("TRAVELSET_GET_ENTITY");
    expect(m).to.contain(" DATA es_travel TYPE zstg_demo.\n DATA iv_travel_id TYPE zstg_travel_id.\n DATA et_return  TYPE bapiret2_t.\n DATA ls_et_return  LIKE LINE OF et_return.");
    expect(m).to.contain(" iv_travel_id = ls_converted_keys-travel_id.");
    expect(m).to.contain("lv_destination = /iwbep/cl_sb_gen_dpc_rt_util=>get_rfc_destination( io_dp_facade = lo_dp_facade ).");
    expect(m).to.contain(" lv_rfc_name = 'Z_STG_TRAVEL_GET'.\n\n IF lv_destination IS INITIAL OR lv_destination EQ 'NONE'.");
    expect(m).to.contain("       CALL FUNCTION lv_rfc_name\n         EXPORTING\n           iv_travel_id   = iv_travel_id\n         IMPORTING\n           es_travel      = es_travel\n           et_return      = et_return\n         EXCEPTIONS\n           system_failure = 1000  MESSAGE lv_exc_msg\n           OTHERS         = 1002.");
    expect(m).to.contain("   CALL FUNCTION lv_rfc_name DESTINATION lv_destination\n");
    expect(m).to.contain("       communication_failure = 1001  MESSAGE lv_exc_msg");
    expect(m).to.contain("me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(");
    expect(m).to.contain(" er_entity-travel_id = es_travel-travel_id.\n er_entity-seats = es_travel-seats.");
    expect(m).not.to.contain("commit_work");
  });

  it("writes the RFC query: filter ranges into the range table, constants, top/skip on the result", () => {
    const m = method("TRAVELSET_GET_ENTITYSET");
    expect(m).to.contain(" DATA lr_travel_id LIKE RANGE OF ls_converted_keys-travel_id.");
    expect(m).to.contain(" iv_with_texts = 'X'.");
    expect(m).to.contain("         WHEN 'TRAVEL_ID'.              \" Equivalent to 'TravelId' property in the service");
    expect(m).to.contain("             ls_it_travel_id_range-high = ls_travel_id-high.\n             ls_it_travel_id_range-low = ls_travel_id-low.\n             ls_it_travel_id_range-option = ls_travel_id-option.\n             ls_it_travel_id_range-sign = ls_travel_id-sign.\n             APPEND ls_it_travel_id_range TO it_travel_id_range.");
    expect(m).to.contain("   lv_top = LINES( et_travel ).");
    expect(m).to.contain(" LOOP AT et_travel INTO ls_et_travel\n");
    expect(m).to.contain("   ls_gw_et_travel-travel_id = ls_et_travel-travel_id.\n   ls_gw_et_travel-seats = ls_et_travel-seats.\n   APPEND ls_gw_et_travel TO et_entityset.");
  });

  it("writes the search-help query through /IWBEP/IF_SB_GENDPC_SHLP_DATA", () => {
    expect(dpc).to.contain("  interfaces /IWBEP/IF_SB_GENDPC_SHLP_DATA .");
    expect(dpc).to.contain("  method /IWBEP/IF_SB_GENDPC_SHLP_DATA~GET_SEARCH_HELP_VALUES.");
    const m = method("STATUSVHSET_GET_ENTITYSET");
    expect(m).to.contain("        ls_selopt-shlpfield = 'STATUS'.\n        ls_selopt-shlpname = 'ZSTG_STATUS_SH'.");
    expect(m).to.contain("    iv_shlp_name = 'ZSTG_STATUS_SH'\n    iv_maxrows = lv_max_hits");
    expect(m).to.contain("    WHEN 'STATUS'.\n      ls_entityset-status = ls_result_list-field_value.\n    WHEN 'TEXT'.\n      ls_entityset-text = ls_result_list-field_value.");
  });

  it("leaves a stub and a warning when the function group is not at hand", () => {
    const w = [];
    const {files: without} = generate(readFileSync("test/fixtures/segw/zstg_mapped.iwpr.xml", "utf8"), {functionModules: new Map(), warnings: w});
    expect(w).to.have.length(2);
    expect(w.join("\n")).to.contain("Z_STG_TRAVEL_LIST").and.to.contain("Z_STG_TRAVEL_GET");
    expect(without["zcl_zstg_mapped_dpc.clas.abap"]).to.contain("* Mapped to Z_STG_TRAVEL_GET: the function group was not available when this class was generated\n  RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc");
  });
});
