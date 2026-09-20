// BSP applications served by this system's own ABAP.
import {expect} from "chai";
import {applications, mimeOf, registryClass} from "../tools/osd-bsp-registry.mjs";

describe("tools/osd-bsp-registry: a BSP application is an object, not a folder", () => {
  it("reads the pages the descriptor names, from the files abapGit would write", () => {
    const apps = applications(["src"]);
    expect(apps.length, "the tree carries at least one BSP application").to.be.greaterThan(0);
    const app = apps.find((a) => a.app === "ZOSD_008_APP");
    expect(app, "the demo app is in the tree").to.not.equal(undefined);
    expect(app.pages.map((p) => p.page)).to.include.members(
      ["index.html", "manifest.json", "Component.js", "i18n/i18n.properties"]);
    // the descriptor is the object: a page it names with no file is an error
    // and not a smaller application
    expect(app.missing, `missing: ${app.missing.join(", ")}`).to.deep.equal([]);
  });

  it("a page is typed by its name, because the object carries no MIME", () => {
    expect(mimeOf("index.html")).to.contain("text/html");
    expect(mimeOf("i18n/i18n.properties")).to.contain("text/plain");
    expect(mimeOf("osg.svg")).to.equal("image/svg+xml");
    expect(mimeOf("x.png")).to.equal("image/png");
    // unknown is bytes, not a guess
    expect(mimeOf("x.zzz")).to.equal("application/octet-stream");
  });

  it("the generated class is ABAP that carries the bytes, not a path to them", () => {
    const abap = registryClass(applications(["src"]));
    expect(abap).to.contain("CLASS zcl_stg_bsp_registry DEFINITION");
    expect(abap).to.contain("ls_page-app  = `ZOSD_008_APP`.");
    // base64 and not a string literal: a page has quotes and newlines in it,
    // a page may be binary, and zcl_abapgit_convert already decodes base64 --
    // three reasons not to write a second encoder
    expect(abap).to.contain("ls_page-b64 = ls_page-b64 && `");
    expect(abap, "no raw page content in the source").to.not.contain("<!DOCTYPE html>");
  });
});
