// A scalar's ABAP type into the IR's: literal, CDS built-in, or a data
// element somebody's dictionary resolves -- and a named refusal otherwise.
//
// Measured on the corpus before this existed (2026-09-22): the coverage
// instrument handed the binder no scalar types at all, so 36 working bodies
// were counted as "unknown scalar :p_clnt" -- a property of the instrument.
// The rule under test is the one the critic asked for: a type that cannot
// be resolved is refused by name, never read as STRING.
import {expect} from "chai";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scalarTypeOf, signatureScalars, isTableParameter, UnresolvedScalarType} from "../tools/sqlscript/scalar-types.mjs";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr, BindError} from "../tools/sqlscript/to-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";

const dtel = (name, datatype, leng, decimals = 0) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DD04V>
    <ROLLNAME>${name}</ROLLNAME><DATATYPE>${datatype}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG><DECIMALS>${String(decimals).padStart(6, "0")}</DECIMALS>
 </DD04V></asx:values></asx:abap></abapGit>`;
const domainOnly = (name, domain) => `<abapGit><asx:abap><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DOMNAME>${domain}</DOMNAME><REFKIND>D</REFKIND></DD04V></asx:values></asx:abap></abapGit>`;
const doma = (name, datatype, leng) => `<abapGit><asx:abap><asx:values><DD01V><DOMNAME>${name}</DOMNAME><DATATYPE>${datatype}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG><DECIMALS>000000</DECIMALS></DD01V></asx:values></asx:abap></abapGit>`;

describe("ABAP scalar types into the IR", () => {
  it("reads the literal forms a method signature spells", () => {
    expect(scalarTypeOf("I")).to.deep.equal({abap: "I"});
    expect(scalarTypeOf("string")).to.deep.equal({abap: "STRING"});
    expect(scalarTypeOf("C LENGTH 10")).to.deep.equal({abap: "C", len: 10});
    expect(scalarTypeOf("char25")).to.deep.equal({abap: "C", len: 25});
    expect(scalarTypeOf("P LENGTH 15 DECIMALS 2")).to.deep.equal({abap: "P", len: 15, dec: 2});
    expect(scalarTypeOf("D")).to.deep.equal({abap: "C", len: 8});
  });

  it("reads the CDS built-ins a DDLS spells", () => {
    expect(scalarTypeOf("abap.clnt")).to.deep.equal({abap: "C", len: 3});
    expect(scalarTypeOf("abap.char(10)")).to.deep.equal({abap: "C", len: 10});
    expect(scalarTypeOf("abap.dec( 15, 2 )")).to.deep.equal({abap: "P", len: 15, dec: 2});
    expect(scalarTypeOf("abap.int4")).to.deep.equal({abap: "I"});
    expect(scalarTypeOf("abap.unit( 3 )")).to.deep.equal({abap: "C", len: 3});
  });

  it("resolves a data element through whoever holds the dictionary, and refuses by name without one", () => {
    const resolve = (name) => (name === "MANDT" ? {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0} : undefined);
    expect(scalarTypeOf("mandt", resolve)).to.deep.equal({abap: "C", len: 3});
    expect(() => scalarTypeOf("db_schema", resolve)).to.throw(UnresolvedScalarType, /DB_SCHEMA is not in any dictionary/);
    expect(() => scalarTypeOf("db_schema")).to.throw(UnresolvedScalarType);
  });

  it("never falls back to STRING: a datatype it has no rendering for is a refusal too", () => {
    const resolve = () => ({DATATYPE: "FLTP", LENG: 16, DECIMALS: 16});
    expect(() => scalarTypeOf("zfloat", resolve)).to.throw(UnresolvedScalarType, /FLTP/);
  });

  it("types the scalar IN parameters of a signature and keeps the unresolved ones apart", () => {
    const signature = {parameters: [
      {name: "iv_count", direction: "IN", abapType: "i"},
      {name: "iv_schema", direction: "IN", abapType: "db_schema"},
      {name: "it_rows", direction: "IN", abapType: "tt_rows"},
      {name: "et_out", direction: "OUT", abapType: "tt_out"},
    ]};
    const {types, unresolved} = signatureScalars(signature, () => undefined);
    expect(types).to.deep.equal({IV_COUNT: {abap: "I"}});
    expect(Object.keys(unresolved)).to.deep.equal(["IV_SCHEMA"]);
    expect(isTableParameter({name: "it_rows", abapType: "tt_rows"})).to.equal(true);
  });
});

describe("the binder takes its scalars from the signature", () => {
  const catalogue = {SRC: {MANDT: {abap: "C", len: 3}, K: {abap: "C", len: 4}, N: {abap: "I"}}};
  const bind = (body, signature, resolveType) => toIr(parse(new Body(), lex(body)), {catalogue, signature, resolveType});

  it("binds :p_clnt as a CHAR(3) parameter when the signature says mandt and a dictionary resolves it", () => {
    const signature = {parameters: [{name: "p_clnt", direction: "IN", abapType: "mandt"}]};
    const resolveType = (name) => (name === "MANDT" ? {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0} : undefined);
    const ir = bind("SELECT k FROM src WHERE mandt = :p_clnt;", signature, resolveType);
    const {sql, params} = lower(ir.rel, "hana");
    expect(sql).to.match(/"MANDT" = /);
    expect(params.map((p) => p.name)).to.deep.equal(["P_CLNT"]);
    expect(String(params[0].type)).to.equal("C(3)");
  });

  it("refuses a referenced parameter whose type no dictionary resolves, by name and with the reason", () => {
    const signature = {parameters: [{name: "iv_schema", direction: "IN", abapType: "db_schema"}]};
    expect(() => bind("SELECT k FROM src WHERE k = :iv_schema;", signature))
      .to.throw(BindError, /scalar :iv_schema has a type this run cannot resolve \(data element DB_SCHEMA/);
  });

  it("does not refuse a body for an unresolvable parameter it never mentions", () => {
    const signature = {parameters: [
      {name: "iv_schema", direction: "IN", abapType: "db_schema"},
      {name: "iv_n", direction: "IN", abapType: "i"},
    ]};
    const ir = bind("SELECT k FROM src WHERE n = :iv_n;", signature);
    expect(lower(ir.rel, "hana").params.map((p) => p.name)).to.deep.equal(["IV_N"]);
  });

  it("still says 'unknown scalar' for a name the signature does not declare at all", () => {
    expect(() => bind("SELECT k FROM src WHERE n = :nobody;", {parameters: []}))
      .to.throw(BindError, /unknown scalar :nobody/);
  });
});

describe("a dictionary read off folders of abapGit XML", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-folder-ddic-"));
    writeFileSync(join(dir, "mandt.dtel.xml"), dtel("MANDT", "CLNT", 3));
    writeFileSync(join(dir, "zflag.dtel.xml"), domainOnly("ZFLAG", "ZFLAG_D"));
    writeFileSync(join(dir, "zflag_d.doma.xml"), doma("ZFLAG_D", "CHAR", 1));
    writeFileSync(join(dir, "zorphan.dtel.xml"), domainOnly("ZORPHAN", "ZNOWHERE"));
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("resolves an element with its type inline, and one that takes it from its domain", () => {
    const resolve = new FolderDdic([dir]).resolver();
    expect(scalarTypeOf("mandt", resolve)).to.deep.equal({abap: "C", len: 3});
    expect(scalarTypeOf("zflag", resolve)).to.deep.equal({abap: "C", len: 1});
  });

  it("refuses an element whose domain is not there, and one that is not there at all", () => {
    const resolve = new FolderDdic([dir]).resolver();
    expect(() => scalarTypeOf("zorphan", resolve)).to.throw(UnresolvedScalarType);
    expect(() => scalarTypeOf("znothing", resolve)).to.throw(UnresolvedScalarType);
  });

  it("skips a folder that is not there rather than failing the run", () => {
    expect(new FolderDdic([join(dir, "missing")]).size).to.equal(0);
  });
});
