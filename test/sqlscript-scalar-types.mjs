// A scalar's ABAP type into the IR's: literal, CDS built-in, or a data
// element somebody's dictionary resolves -- and a named refusal otherwise.
//
// Measured on the corpus before this existed (2026-09-22): the coverage
// instrument handed the binder no scalar types at all, so 36 working bodies
// were counted as "unknown scalar :p_clnt" -- a property of the instrument.
// The rule under test is the one the critic asked for: a type that cannot
// be resolved is refused by name, never read as STRING.
import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scalarTypeOf, signatureScalars, isTableParameter, unresolvedType, UnresolvedScalarType} from "../tools/sqlscript/scalar-types.mjs";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr, BindError} from "../tools/sqlscript/to-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {irTypeFromAbap} from "../tools/sqlscript-to-procedure-ir.mjs";
import {UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";

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
    expect(() => scalarTypeOf("db_schema", resolve)).to.throw(UnresolvedScalarType, /DB_SCHEMA is not a data element in any dictionary/);
    expect(() => scalarTypeOf("db_schema")).to.throw(UnresolvedScalarType);
  });

  it("gives bare C, N and X ABAP's default length of one", () => {
    expect(scalarTypeOf("c")).to.deep.equal({abap: "C", len: 1});
    expect(scalarTypeOf("n")).to.deep.equal({abap: "C", len: 1});
    expect(scalarTypeOf("x")).to.deep.equal({abap: "X", len: 1});
  });

  it("refuses a length-bearing CDS built-in that lost its length rather than making a CHAR of no length", () => {
    for (const cut of ["abap.char", "abap.numc", "abap.dec", "abap.raw"]) {
      expect(() => scalarTypeOf(cut)).to.throw(UnresolvedScalarType, /needs its length/);
    }
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
      .to.throw(BindError, /scalar :iv_schema has a type this run cannot resolve \(DB_SCHEMA is not a data element/);
  });

  it("does not refuse a body for an unresolvable parameter it never mentions", () => {
    const signature = {parameters: [
      {name: "iv_schema", direction: "IN", abapType: "db_schema"},
      {name: "iv_n", direction: "IN", abapType: "i"},
    ]};
    const ir = bind("SELECT k FROM src WHERE n = :iv_n;", signature);
    expect(lower(ir.rel, "hana").params.map((p) => p.name)).to.deep.equal(["IV_N"]);
  });

  it("refuses a column the dictionary could not type when the body reads it, and not before", () => {
    const dark = {SRC: {K: {abap: "C", len: 4}, Z: unresolvedType("SRC.Z: ZUNKNOWN is not a data element")}};
    const bindOn = (body) => toIr(parse(new Body(), lex(body)), {catalogue: dark});
    expect(lower(bindOn("SELECT k FROM src;").rel, "duckdb").sql).to.match(/"K"/);
    expect(() => bindOn("SELECT z FROM src;")).to.throw(BindError, /column z has no resolved type \(SRC.Z: ZUNKNOWN/i);
    expect(() => bindOn("SELECT s.z FROM src AS s;")).to.throw(BindError, /column S.Z has no resolved type/i);
    expect(() => bindOn("SELECT * FROM src;")).to.throw(BindError, /SELECT \* would carry column Z/);
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

  it("counts a resolution once, credited to the folder that held the element, and records who took over a name", () => {
    const later = mkdtempSync(join(tmpdir(), "osd-folder-ddic-later-"));
    try {
      writeFileSync(join(later, "mandt.dtel.xml"), dtel("MANDT", "CLNT", 3));
      const ddic = new FolderDdic([dir, later]);
      const resolve = ddic.resolver();
      scalarTypeOf("mandt", resolve);
      scalarTypeOf("zflag", resolve);
      scalarTypeOf("zflag", resolve);
      expect(() => scalarTypeOf("zorphan", resolve)).to.throw(UnresolvedScalarType);
      expect(ddic.hits.get(later)).to.equal(1);
      expect(ddic.hits.get(dir)).to.equal(2);
      expect(ddic.overrides).to.deep.equal([{key: "DTEL:MANDT", was: dir, now: later}]);
      expect(ddic.describe().at(-1)).to.match(/1 names taken over by a later folder/);
    } finally {
      rmSync(later, {recursive: true, force: true});
    }
  });

  it("records the same name twice inside one folder instead of letting readdir order decide quietly", () => {
    const twice = mkdtempSync(join(tmpdir(), "osd-folder-ddic-twice-"));
    try {
      writeFileSync(join(twice, "mandt.dtel.xml"), dtel("MANDT", "CLNT", 3));
      mkdirSync(join(twice, "sub"));
      writeFileSync(join(twice, "sub", "mandt.dtel.xml"), dtel("MANDT", "CLNT", 3));
      const ddic = new FolderDdic([twice]);
      expect(ddic.overrides).to.have.length(1);
      expect(ddic.overrides[0].duplicate).to.equal(true);
      expect(ddic.describe().at(-1)).to.match(/twice inside one folder/);
    } finally {
      rmSync(twice, {recursive: true, force: true});
    }
  });
});

describe("the procedure compiler admits only the measured types, dictionary or not", () => {
  it("still refuses what it refused before the shared reader existed", () => {
    for (const type of ["NUMC5", "N LENGTH 5", "XSTRING", "INT8", "abap.numc(3)", "abap.rawstring", "abap.fltp"]) {
      expect(() => irTypeFromAbap(type), type).to.throw(UnsupportedSqlScript, /no portable SQLScript mapping/);
    }
  });

  it("admits a CDS built-in of a measured datatype, as a DDLS RETURNS spells it", () => {
    expect(irTypeFromAbap("abap.char(10)")).to.deep.equal({abap: "C", len: 10});
    expect(irTypeFromAbap("abap.int4")).to.deep.equal({abap: "I"});
    expect(irTypeFromAbap("abap.dec(15,2)")).to.deep.equal({abap: "P", len: 15, dec: 2});
    expect(irTypeFromAbap("abap.string")).to.deep.equal({abap: "STRING"});
    expect(irTypeFromAbap("abap.dats")).to.deep.equal({abap: "C", len: 8});
    expect(irTypeFromAbap("abap.tims")).to.deep.equal({abap: "C", len: 6});
    // fixed RAW is measured since 2026-09-23 (n bytes, initial all zeros)
    expect(irTypeFromAbap("abap.raw(16)")).to.deep.equal({abap: "X", len: 16});
    expect(irTypeFromAbap("X LENGTH 16")).to.deep.equal({abap: "X", len: 16});
  });

  it("admits a data element only with a dictionary, and only when it resolves to a measured datatype", () => {
    const resolve = (name) => ({TABNAME: {DATATYPE: "CHAR", LENG: 30, DECIMALS: 0}, MANDT: {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0}, ZNUM: {DATATYPE: "NUMC", LENG: 5, DECIMALS: 0}})[name];
    expect(irTypeFromAbap("tabname", resolve)).to.deep.equal({abap: "C", len: 30});
    expect(() => irTypeFromAbap("tabname")).to.throw(UnsupportedSqlScript);
    // CLNT is admitted since it was measured on A4H (2026-09-23): a client
    // input arrives as its three characters, right-trimmed like CHAR
    expect(irTypeFromAbap("mandt", resolve)).to.deep.equal({abap: "C", len: 3});
    expect(irTypeFromAbap("abap.clnt")).to.deep.equal({abap: "C", len: 3});
    expect(() => irTypeFromAbap("znum", resolve)).to.throw(UnsupportedSqlScript, /no portable SQLScript mapping/);
  });
});
