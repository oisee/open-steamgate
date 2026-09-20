// BSP applications served by this system's own ABAP.
import {expect} from "chai";
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {W3MI_NAME_WIDTH, applications, generate, mimeOf, registryClass, w3miFile, w3miName} from "../tools/osd-bsp-registry.mjs";

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

  it("the generated class is a list, and the bytes are not in it", () => {
    const abap = registryClass(applications(["src"]));
    expect(abap).to.contain("CLASS zcl_stg_bsp_registry DEFINITION");
    expect(abap).to.contain("ls_page-app   = `ZOSD_008_APP`.");
    expect(abap).to.contain("ls_page-objid = `ZOSD_008_APP/INDEX.HTML`.");
    // **The defect this replaced**: 33 pages as chunked base64, 141 KB of
    // assets in a generated ABAP source, a transpile on every image. The
    // bytes live in Web Repository objects beside the class now, which is
    // the mechanism this tree already carries 33 media objects on.
    expect(abap, "no base64 payload").to.not.contain("ls_page-b64");
    expect(abap, "no raw page content either").to.not.contain("<!DOCTYPE html>");
    expect(abap.length, "a list, not a payload").to.be.lessThan(30000);
  });

  it("a page's Web Repository name fits the column it is stored in", () => {
    // WWWPARAMS-OBJID is CHAR 40 in the DDIC -- read, not remembered. The
    // first version of this said 60 and three of the 33 pages were longer
    // than the column, which is the same defect as a versioned file name
    // written narrower than its fixed width.
    for (const app of applications(["src"])) {
      for (const page of app.pages) {
        expect(w3miName(app.app, page.page).length, `${app.app}/${page.page}`)
          .to.be.at.most(W3MI_NAME_WIDTH);
      }
    }
  });

  it("the file name escapes the dot, because abaplint reads the type out of it", () => {
    // `ztravels_a4h_-manifest.json.w3mi.xml` parses as an object of type
    // `json.w3mi` and comes back "Unknown object type" -- 33 of these failed
    // the lint before abapGit's own percent-escape was copied.
    expect(w3miFile("ZOSD_008_APP", "i18n/i18n.properties"))
      .to.equal("zosd_008_app_-i18n_-i18n%2eproperties");
    expect(w3miFile("Z", "manifest.json")).to.not.contain(".json.");
  });

  it("writes one object per page and sweeps what it did not write", () => {
    const out = mkdtempSync(join(tmpdir(), "osd-bsp-"));
    // a stale object from an earlier run: it is in an input folder, so it
    // would be transpiled and would fill a wwwparams row for a page no
    // application has
    const stale = join(out, "zgone_-old%2ehtml.w3mi.xml");
    writeFileSync(stale, "<abapGit/>");
    const apps = generate(["src"], out);
    const written = readdirSync(out);
    expect(written).to.not.include("zgone_-old%2ehtml.w3mi.xml");
    const pages = apps.reduce((n, a) => n + a.pages.length, 0);
    expect(written.filter((f) => f.endsWith(".w3mi.xml")).length,
      "one object per page").to.equal(pages);
    // and the object carries no filesize of its own: the transpiler writes
    // one from the data file's real length, and two rows of the same key
    // kill the seed with `UNIQUE constraint failed: wwwparams`
    const one = readFileSync(join(out, written.find((f) => f.endsWith(".w3mi.xml"))), "utf8");
    expect(one).to.contain("<NAME>");
    expect(one, "the size comes from the bytes, not from us").to.not.contain("filesize");
  });
});
