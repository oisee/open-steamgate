import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {contentFoldersOf} from "../tools/osd-packs.mjs";
import {generate} from "../tools/amdp-gen.mjs";

describe("AMDP in a content pack", () => {
  it("discovers and rewrites a pack-local AMDP class", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-amdp-pack-"));
    const src = join(root, "src");
    const pack = join(root, "packs", "vectors");
    const packSrc = join(pack, "src");
    const out = join(root, "gen", "amdp");
    mkdirSync(src, {recursive: true});
    mkdirSync(packSrc, {recursive: true});
    writeFileSync(join(pack, "osd-pack.json"), JSON.stringify({name: "vectors"}));
    writeFileSync(join(packSrc, "zcl_vector_amdp.clas.abap"), `
CLASS zcl_vector_amdp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS answer IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(ev_n) TYPE i.
ENDCLASS.
CLASS zcl_vector_amdp IMPLEMENTATION.
  METHOD answer BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    ev_n = :iv_n;
  ENDMETHOD.
ENDCLASS.\n`);

    const folders = contentFoldersOf(root);
    expect(folders).to.deep.equal(["src", "packs/vectors/src"]);
    const made = generate(folders.map((folder) => join(root, folder)), out);
    expect(made.procedures).to.have.length(1);
    expect(readFileSync(join(out, "zcl_vector_amdp.clas.abap"), "utf8"))
      .to.contain("DESTINATION 'AMDP'").and.not.contain("ev_n = :iv_n");
  });
});
