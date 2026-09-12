import {expect} from "chai";
import {readFileSync} from "node:fs";
import {generate} from "../tools/segw-gen.mjs";

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
