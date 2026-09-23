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

describe("amdp-gen reads a table function's DDLS through the runtime store by the entity it defines", () => {
  it("a DDL source whose object name is not the entity still gives the method its RETURNS", async () => {
    const {ObjectStore} = await import("../tools/osd-store.mjs");
    const {rmSync} = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "osd-amdp-entity-"));
    try {
      const src = join(root, "src");
      mkdirSync(src, {recursive: true});
      // the object is ZSTG_DDL_SRC, the entity it defines is ZSTG_TF_ENTITY,
      // and the class names the entity, as FOR TABLE FUNCTION always does
      writeFileSync(join(src, "zstg_ddl_src.ddls.asddls"), `@EndUserText.label: 'x'
define table function Zstg_Tf_Entity
returns { k : abap.int4; }
implemented by method zcl_stg_tf_entity=>get;\n`);
      writeFileSync(join(src, "zcl_stg_tf_entity.clas.abap"), `
CLASS zcl_stg_tf_entity DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS get FOR TABLE FUNCTION zstg_tf_entity.
ENDCLASS.
CLASS zcl_stg_tf_entity IMPLEMENTATION.
  METHOD get BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    RETURN SELECT 1 AS k FROM dummy;
  ENDMETHOD.
ENDCLASS.\n`);
      const store = new ObjectStore({root, roots: [{path: "src", package: "$ENTITY", writable: false}], libs: []});
      expect(store.read("DDLS", "ZSTG_TF_ENTITY").source).to.contain("Zstg_Tf_Entity");
      const made = generate([src], join(root, "gen", "amdp"), {store});
      expect(made.procedures).to.have.length(1);
      expect(made.procedures[0].portableRefusal, JSON.stringify(made.procedures[0].portableRefusal)).to.equal(undefined);
      expect(made.procedures[0].portable.outputSchema).to.deep.equal({K: {abap: "I"}});
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  describe("the store's entity look-up stays a read, and follows writes", () => {
    let root, store, ObjectStore;
    const ddls = (entity) => `define table function ${entity} returns { k : abap.int4; } implemented by method cl_x=>m;\n`;
    beforeEach(async () => {
      ({ObjectStore} = await import("../tools/osd-store.mjs"));
      root = mkdtempSync(join(tmpdir(), "osd-store-entity-"));
      mkdirSync(join(root, "src"), {recursive: true});
      writeFileSync(join(root, "src", "z_src.ddls.asddls"), ddls("Z_OLD"));
      store = new ObjectStore({root, roots: [{path: "src", package: "$ENTITY", writable: true}], libs: []});
    });
    afterEach(async () => {
      const {rmSync} = await import("node:fs");
      rmSync(root, {recursive: true, force: true});
    });

    it("follows a rewrite of the source to its new entity", () => {
      expect(store.read("DDLS", "Z_OLD").source).to.contain("Z_OLD");
      store.write("DDLS", "Z_SRC", ddls("Z_NEW"));
      expect(store.read("DDLS", "Z_NEW").source).to.contain("Z_NEW");
      expect(() => store.read("DDLS", "Z_OLD")).to.throw(/does not exist/);
    });

    it("forgets the entity of a deleted source", () => {
      expect(store.read("DDLS", "Z_OLD").source).to.contain("Z_OLD");
      store.delete("DDLS", "Z_SRC");
      expect(() => store.read("DDLS", "Z_OLD")).to.throw(/does not exist/);
    });

    it("never resolves a write target by entity: a write to the entity name is a new object", () => {
      store.write("DDLS", "Z_OLD", ddls("Z_OTHER"));
      expect(readFileSync(join(root, "src", "z_src.ddls.asddls"), "utf8")).to.contain("Z_OLD");
      expect(store.read("DDLS", "Z_SRC").source).to.contain("Z_OLD");
    });

    it("takes neither of two sources defining one entity", () => {
      writeFileSync(join(root, "src", "z_two.ddls.asddls"), ddls("Z_OLD"));
      const fresh = new ObjectStore({root, roots: [{path: "src", package: "$ENTITY", writable: true}], libs: []});
      expect(() => fresh.read("DDLS", "Z_OLD")).to.throw(/does not exist/);
      expect(fresh.read("DDLS", "Z_TWO").source).to.contain("Z_OLD");
    });
  });
});
