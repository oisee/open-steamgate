import {expect} from "chai";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {segwRegistrations, registryClass} from "../tools/segw-registry.mjs";

describe("tools/segw-registry: IWSV/IWMO -> service registry", () => {
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
