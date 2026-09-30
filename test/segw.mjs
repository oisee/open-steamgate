import {expect} from "chai";
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, join} from "node:path";
import {contentFoldersOf} from "../tools/osd-packs.mjs";
import {segwRegistrations, registryClass} from "../tools/segw-registry.mjs";

describe("tools/segw-registry: IWSV/IWMO -> service registry", () => {
  it("uses the last user layer's SEGW registration once", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-segw-layers-"));
    try {
      for (const folder of ["src", "first", "second"]) mkdirSync(join(root, folder));
      const xml = (dpc) => `<abapGit><_-IWBEP_-I_MGW_SRG><MODEL_TECH_NAME>ZLAYER_MDL</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG><_-IWBEP_-I_MGW_SRH><TECHNICAL_NAME>ZLAYER_SRV</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>${dpc}</CLASS_NAME></_-IWBEP_-I_MGW_SRH></abapGit>`;
      for (const [folder, dpc] of [["src", "ZCL_SYSTEM_DPC"], ["first", "ZCL_FIRST_DPC"], ["second", "ZCL_SECOND_DPC"]]) {
        writeFileSync(join(root, folder, "zlayer_srv.iwsv.xml"), xml(dpc));
      }
      writeFileSync(join(root, "src", "zlayer_mdl.iwmo.xml"), "<abapGit><_-IWBEP_-I_MGW_OHD><TECHNICAL_NAME>ZLAYER_MDL</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>ZCL_LAYER_MPC</CLASS_NAME></_-IWBEP_-I_MGW_OHD></abapGit>");
      const env = {OSD_LAYERS: ["first", "second"].join(delimiter)};
      const entries = segwRegistrations(contentFoldersOf(root, env).map((folder) => join(root, folder)));
      expect(entries).to.have.length(1);
      expect(entries[0]).to.include({dpc: "ZCL_SECOND_DPC", mpc: "ZCL_LAYER_MPC"});
      expect(registryClass(entries)).to.contain("iv_dpc     = 'ZCL_SECOND_DPC'");
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
  it("registers duplicate external endpoints in layer order regardless of technical name", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-segw-endpoint-"));
    try {
      for (const folder of ["src", "overlay"]) mkdirSync(join(root, folder));
      const xml = (technical, dpc) => `<abapGit><_-IWBEP_-I_MGW_SRH><TECHNICAL_NAME>${technical}</TECHNICAL_NAME>` +
        `<EXTERNAL_NAME>ZSHARED_SRV</EXTERNAL_NAME><CLASS_NAME>${dpc}</CLASS_NAME></_-IWBEP_-I_MGW_SRH></abapGit>`;
      writeFileSync(join(root, "src", "zzz_base.iwsv.xml"), xml("ZZZ_BASE", "ZCL_BASE_DPC"));
      writeFileSync(join(root, "overlay", "aaa_override.iwsv.xml"), xml("AAA_OVERRIDE", "ZCL_OVERRIDE_DPC"));
      const entries = segwRegistrations([join(root, "src"), join(root, "overlay")]);
      expect(entries.map((entry) => entry.dpc)).to.deep.equal(["ZCL_BASE_DPC", "ZCL_OVERRIDE_DPC"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
  it("reads the demo's registration objects", () => {
    const entries = segwRegistrations(["src"]);
    const demo = entries.find((e) => e.external === "ZSTG_DEMO_SRV");
    expect(demo).to.include({mpc: "ZCL_ZSTG_DEMO_MPC_EXT", dpc: "ZCL_ZSTG_DEMO_DPC_EXT", model: "ZSTG_DEMO_MDL"});
    const sadl = entries.find((e) => e.external === "ZSTG_SADL_SRV");
    expect(sadl).to.include({mpc: "ZCL_ZSTG_SADL_MPC_EXT", dpc: "ZCL_ZSTG_SADL_DPC_EXT"});
    const abap = registryClass(entries);
    expect(abap).to.contain("iv_service = 'ZSTG_DEMO_SRV'");
    expect(abap).to.contain("iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT'");
  });

  it("takes abapGit's padded file names, joins model versions, notes a missing IWMO", () => {
    const dir = mkdtempSync(join(tmpdir(), "stg-segw-"));
    const iwsv = (srv, mdl, dpc) => `<?xml version="1.0" encoding="utf-8"?><abapGit><asx:abap><asx:values>
<_-IWBEP_-I_MGW_SRG><_-IWBEP_-I_MGW_SRG><GROUP_TECH_NAME>${srv}</GROUP_TECH_NAME><GROUP_VERSION>0001</GROUP_VERSION><MODEL_TECH_NAME>${mdl}</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG></_-IWBEP_-I_MGW_SRG>
<_-IWBEP_-I_MGW_SRH><_-IWBEP_-I_MGW_SRH><TECHNICAL_NAME>${srv}</TECHNICAL_NAME><VERSION>0001</VERSION><EXTERNAL_NAME>${srv}</EXTERNAL_NAME><CLASS_NAME>${dpc}</CLASS_NAME></_-IWBEP_-I_MGW_SRH></_-IWBEP_-I_MGW_SRH>
</asx:values></asx:abap></abapGit>`;
    const iwmo = (mdl, mpc) => `<?xml version="1.0" encoding="utf-8"?><abapGit><asx:abap><asx:values>
<_-IWBEP_-I_MGW_OHD><_-IWBEP_-I_MGW_OHD><TECHNICAL_NAME>${mdl}</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>${mpc}</CLASS_NAME></_-IWBEP_-I_MGW_OHD></_-IWBEP_-I_MGW_OHD>
</asx:values></asx:abap></abapGit>`;
    writeFileSync(join(dir, "zui5_code_search_srv               0001.iwsv.xml"), iwsv("ZUI5_CODE_SEARCH_SRV", "ZUI5_CODE_SEARCH_MDL", "ZCL_ZUI5_CODE_SEARCH_DPC_EXT"));
    writeFileSync(join(dir, "zui5_code_search_mdl            0001.iwmo.xml"), iwmo("ZUI5_CODE_SEARCH_MDL", "ZCL_ZUI5_CODE_SEARCH_MPC_EXT"));
    writeFileSync(join(dir, "zorphan_srv 0001.iwsv.xml"), iwsv("ZORPHAN_SRV", "ZORPHAN_MDL", "ZCL_ZORPHAN_DPC_EXT"));
    try {
      const entries = segwRegistrations([dir]);
      expect(entries.map((e) => e.external)).to.deep.equal(["ZORPHAN_SRV", "ZUI5_CODE_SEARCH_SRV"]);
      expect(entries[1].mpc).to.equal("ZCL_ZUI5_CODE_SEARCH_MPC_EXT");
      expect(entries[0].mpc).to.equal("");
      const abap = registryClass(entries);
      expect(abap).to.contain("iv_service = 'ZUI5_CODE_SEARCH_SRV'");
      expect(abap).to.contain("* ZORPHAN_SRV: no IWMO for model ZORPHAN_MDL, not registered");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
