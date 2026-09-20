import {expect} from "chai";
import {createHash} from "node:crypto";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

const root = "deploy/lsd-a4h-011/src";
const files = readdirSync(root);
const read = (name) => readFileSync(join(root, name), "utf8");

describe("isolated A4H LSD package 011", () => {
  it("uses a fresh and internally consistent SAPC identity", () => {
    const sapc = read("zosd_011_lsd.sapc.xml");
    expect(sapc).to.include("<APPLICATION_ID>ZOSD_011_LSD</APPLICATION_ID>");
    expect(sapc).to.include("<CLASS_NAME>ZCL_ZOSD_011_LSD_APC</CLASS_NAME>");
    expect(sapc).to.include("<PATH>/sap/bc/apc/sap/zosd_011_lsd</PATH>");
    expect(sapc).to.include("<STATEFUL>X</STATEFUL>");
    expect(sapc).not.to.include("<CONNECTION_TYPE>");
    expect(sapc).not.to.include("<PROTOCOL_TYPE_ID>");
    expect(read("zcl_zosd_011_lsd_apc.clas.abap")).to.include("INHERITING FROM cl_apc_wsp_ext_stateful_base");
  });

  it("uses abapGit SICF filenames and separate HTTP/APC routes", () => {
    for (const url of ["/sap/bc/zosd_011_lsd/", "/sap/bc/apc/sap/zosd_011_lsd/"]) {
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 25);
      const filename = `${"zosd_011_lsd".padEnd(15, " ")}${hash}.sicf.xml`;
      expect(files).to.include(filename);
      expect(read(filename)).to.include(`<URL>${url}</URL>`);
      expect(read(filename)).to.include("<ICF_NAME>ZOSD_011_LSD</ICF_NAME>");
    }
    expect(read("zcl_zosd_011_lsd_http.clas.abap")).to.include("/sap/bc/apc/sap/zosd_011_lsd");
  });

  it("keeps every class and media object's filename aligned with its metadata", () => {
    for (const name of ["ZCL_ZOSD_011_LSD_APC", "ZCL_ZOSD_011_LSD_HTTP", "ZCL_ZOSD_011_LSD_MEDIA"]) {
      expect(files).to.include(`${name.toLowerCase()}.clas.abap`);
      expect(read(`${name.toLowerCase()}.clas.xml`)).to.include(`<CLSNAME>${name}</CLSNAME>`);
    }
    for (const name of ["ZOSD_011_SHOW", "ZOSD_011_MUSIC"]) {
      expect(read(`${name.toLowerCase()}.w3mi.xml`)).to.include(`<NAME>${name}</NAME>`);
    }
    expect(files).to.include("zosd_011_show.w3mi.data.gz");
    expect(files).to.include("zosd_011_music.w3mi.data.m4a");
    expect(read("zcl_zosd_011_lsd_apc.clas.abap")).to.include("'ZOSD_011_SHOW'");
    expect(read("zcl_zosd_011_lsd_http.clas.abap")).to.include("'ZOSD_011_MUSIC'");
  });

  it("does not retain names or routes from the installed LSD package", () => {
    for (const file of files.filter((name) => !/\.data\.(?:gz|m4a)$/.test(name))) {
      const content = read(file);
      expect(content).not.to.match(/ZAPC_LSD|ZCL_LSD_|ZLSD-|\/sap\/bc\/lsd\//i);
    }
  });
});
