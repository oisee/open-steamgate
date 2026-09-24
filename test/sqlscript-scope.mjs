// What a body may name and how: aliases with and without AS, a table named
// as its own qualifier, and NULL as a literal rather than a column. Every
// case here was a strict-scope refusal in the corpus on 2026-09-22 -- the
// bodies lowered non-strictly by reading a column called NULL, or a column
// of an alias the binder had not registered, as STRING.
import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr, BindError} from "../tools/sqlscript/to-ir.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";

const CATALOGUE = {SRC: {K: {abap: "C", len: 4}, N: {abap: "I"}, MANDT: {abap: "C", len: 3}}, OTHER: {K: {abap: "C", len: 4}, M: {abap: "I"}}};
const GUIDS = {GUID: {abap: "C", len: 32}};
const signature = {parameters: [{name: "it_guid", direction: "IN", abapType: "tt_g", kind: "table", schema: GUIDS}]};
const bind = (body) => toIr(parse(new Body(), lex(body)), {catalogue: {...CATALOGUE, IT_GUID: GUIDS}, signature, relationSchemas: {IT_GUID: GUIDS}, strictColumns: true});
const sql = (body, dialect = "duckdb") => lower(bind(body).rel, dialect).sql;

describe("a source alias without AS", () => {
  it("is an alias all the same, for a table parameter and for a table", () => {
    expect(sql("SELECT a.guid, b.k FROM :it_guid a INNER JOIN src b ON a.guid = b.k;")).to.contain('"A"."GUID"').and.contain('"B"."K"');
  });
});

describe("a schema-qualified source is not mistaken for a table with an alias", () => {
  it("reads sys.m_host as a qualified name, never as table SYS aliased M_HOST", () => {
    expect(() => bind("SELECT host FROM sys.m_host;")).to.throw(BindError, /SYS.M_HOST is a HANA system view/);
    expect(() => bind('SELECT a FROM "SAPABAP1"."T";')).to.throw(BindError, /schema-qualified source SAPABAP1.T is not lowered/);
  });
});

describe("a table without an alias is its own qualifier", () => {
  it("resolves src.k when src is the one source of that name", () => {
    expect(sql("SELECT src.mandt AS client, src.k FROM src;")).to.contain('"SRC"."MANDT"');
    expect(sql("SELECT src.k, other.m FROM src INNER JOIN other ON src.k = other.k;")).to.contain('"OTHER"."M"');
  });

  it("counts ambiguity per FROM: the two branches of a UNION may each read the table bare", () => {
    expect(sql("SELECT src.k FROM src WHERE src.n = 1 UNION ALL SELECT src.k FROM src WHERE src.n = 2;")).to.contain("UNION ALL");
  });

  it("lets a subquery read the same table bare: the inner scope shadows the outer, it does not collide with it", () => {
    expect(sql("SELECT k FROM src WHERE n IN (SELECT src.n FROM src WHERE src.k = 'x');")).to.contain("IN (SELECT");
  });

  it("stays ambiguous and loud for a self-join without aliases", () => {
    expect(() => bind("SELECT src.k FROM src INNER JOIN src ON src.k = src.k;"))
      .to.throw(BindError, /source SRC appears more than once without an alias/);
  });
});

describe("NULL is a literal, not a column", () => {
  it("is refused in a bare projection, by name, rather than typed STRING", () => {
    expect(() => bind("SELECT k, NULL AS context FROM src;")).to.throw(BindError, /NULL AS context has no type here: CAST/);
  });

  it("takes its type from a CAST, from the typed branch of a CASE or MAP, and from the other side of a comparison", () => {
    const cast = bind("SELECT CAST(NULL AS INTEGER) AS n FROM src;").rel;
    expect(cast.items[0].expr.node).to.equal("cast");
    expect(cast.items[0].expr.type).to.deep.equal({abap: "I"});
    const branch = bind("SELECT CASE WHEN n > 1 THEN k ELSE NULL END AS v FROM src;").rel;
    expect(branch.items[0].expr.otherwise.type).to.deep.equal({abap: "C", len: 4});
    const map = bind("SELECT MAP(k, 'x', NULL, k) AS v FROM src;").rel;
    expect(map.items[0].expr.type).to.deep.equal({abap: "C", len: 4});
    expect(sql("SELECT k FROM src WHERE n = NULL;")).to.contain("=");
  });

  it("never leaves the binder untyped: a NULL in a function argument or arithmetic is refused by name", () => {
    expect(() => bind("SELECT COALESCE(k, NULL) AS v FROM src;")).to.throw(BindError, /COALESCE/);
    expect(() => bind("SELECT LENGTH(NULL) AS v FROM src;")).to.throw(BindError, /NULL .* has no type here/);
    expect(() => bind("SELECT n + NULL AS v FROM src;")).to.throw(BindError, /NULL .* has no type here/);
  });

  it("takes the type of the same column in another UNION branch, as HANA does", () => {
    const rel = bind("SELECT 'x' AS k, NULL AS n FROM dummy UNION ALL SELECT k, n FROM src;").rel;
    const first = rel.inputs[0].items[1].expr;
    expect(first).to.include({node: "lit", value: null});
    expect(first.type).to.deep.equal({abap: "I"});
    expect(first.untyped).to.equal(undefined);
    expect(() => bind("SELECT k, NULL AS n FROM src UNION ALL SELECT k, NULL AS n FROM src;"))
      .to.throw(BindError, /NULL AS n has no type here/);
  });

  it("takes the type of the declared output column it is assigned to", () => {
    const out = {parameters: [{name: "et_rows", direction: "OUT", abapType: "tt_rows", kind: "table", schema: {K: {abap: "C", len: 4}, CONTEXT: {abap: "STRING"}}}]};
    const ir = toIr(parse(new Body(), lex("et_rows = SELECT k, NULL AS context FROM src;")), {catalogue: CATALOGUE, signature: out, strictColumns: true});
    expect(ir.rel.items[1].expr.type).to.deep.equal({abap: "STRING"});
    expect(() => toIr(parse(new Body(), lex("et_rows = SELECT k, NULL AS other FROM src;")), {catalogue: CATALOGUE, signature: out, strictColumns: true}))
      .to.throw(BindError, /NULL AS other has no type here/);
  });

  it("refuses a CASE whose every branch is NULL, and the BOOLEAN literals, by name", () => {
    expect(() => bind("SELECT CASE WHEN n > 1 THEN NULL ELSE NULL END AS v FROM src;")).to.throw(BindError, /every branch is NULL/);
    expect(() => bind("SELECT TRUE AS v FROM src;")).to.throw(BindError, /BOOLEAN literal TRUE is not portable yet/);
  });
});

describe("ORDER BY sees the projection's aliases", () => {
  it("sorts by a window column named in the same SELECT", () => {
    const text = sql("SELECT k, row_number() OVER (PARTITION BY k ORDER BY n) AS row_nr FROM src ORDER BY k, row_nr DESC;");
    expect(text).to.match(/ORDER BY "K" ASC NULLS FIRST, "ROW_NR" DESC NULLS LAST/);
  });

  it("still refuses a key that is neither a source column nor an alias", () => {
    expect(() => bind("SELECT k FROM src ORDER BY nobody;")).to.throw(BindError, /column NOBODY is not present/);
  });
});

describe("HANA's own views are refused by name, not guessed", () => {
  it("refuses a source qualified by SYS, PUBLIC or _SYS_*, quoted or not", () => {
    expect(() => bind("SELECT host FROM sys.m_host_information;")).to.throw(BindError, /SYS.M_HOST_INFORMATION is a HANA system view, not portable/);
    expect(() => bind('SELECT a FROM "PUBLIC"."TABLES" AS tab;')).to.throw(BindError, /PUBLIC.TABLES is a HANA system view/);
    expect(() => bind("SELECT a FROM _sys_bi.m_time_dimension;")).to.throw(BindError, /_SYS_BI.M_TIME_DIMENSION is a HANA system view/);
  });

  it("keeps sys.dummy as the one-row source every dialect has", () => {
    expect(sql("SELECT 1 AS one FROM sys.dummy;")).to.match(/SELECT 1 AS "ONE"/);
  });

  it("binds an unqualified M_* the catalogue describes, and refuses one it does not as a monitoring view", () => {
    const ir = toIr(parse(new Body(), lex("SELECT k FROM m_mat1l;")), {catalogue: {M_MAT1L: {K: {abap: "C", len: 4}}}, strictColumns: true});
    expect(lower(ir.rel, "duckdb").sql).to.contain('"M_MAT1L"');
    expect(() => bind("SELECT host FROM m_host;")).to.throw(BindError, /M_HOST is a HANA monitoring view \(M_\*\), not portable/);
  });
});

describe("an alias that shadows a source column", () => {
  it("wins in ORDER BY at the IR level (the engines agree on alias-first; measured separately)", () => {
    const rel = bind("SELECT n + 1 AS n, k FROM src ORDER BY n;").rel;
    expect(rel.rel).to.equal("order");
    expect(rel.keys).to.deep.equal([{col: "N", desc: false}]);
    expect(rel.input.rel).to.equal("project");
  });
});

describe("a table function called in FROM", () => {
  const registry = {
    "CL_X=>GET_ROWS": {name: "CL_X=>GET_ROWS", source: "class", parameters: [{name: "IV_A", kind: "scalar", abapType: "string", type: {abap: "STRING"}}, {name: "IV_N", kind: "scalar", abapType: "i", type: {abap: "I"}}], returns: {K: {abap: "C", len: 4}, V: {abap: "STRING"}}},
    "CL_X=>DARK": {name: "CL_X=>DARK", source: "class", parameters: [{name: "IV_Z", kind: "scalar", abapType: "zunknown", type: {abap: "UNRESOLVED", reason: "CL_X=>DARK.iv_z: ZUNKNOWN is not a data element"}}], returns: {K: {abap: "C", len: 4}}},
    "CL_X=>CONVERT": {name: "CL_X=>CONVERT", source: "class", parameters: [{name: "IT_ROWS", kind: "table", abapType: "tt_rows", schema: {K: {abap: "C", len: 4}}}, {name: "IV_MODE", kind: "scalar", abapType: "i", type: {abap: "I"}, optional: true}], returns: {K: {abap: "C", len: 4}}},
    // an OPTIONAL parameter before a required one: the named-argument gap case
    "CL_X=>GAPPED": {name: "CL_X=>GAPPED", source: "class", parameters: [{name: "IV_OPT", kind: "scalar", abapType: "i", type: {abap: "I"}, optional: true}, {name: "IV_REQ", kind: "scalar", abapType: "i", type: {abap: "I"}}], returns: {K: {abap: "C", len: 4}}},
  };
  const sig = {parameters: [{name: "iv_a", direction: "IN", abapType: "string"}, {name: "it_guid", direction: "IN", abapType: "tt_g", kind: "table", schema: GUIDS}]};
  const call = (body, options = {}) => toIr(parse(new Body(), lex(body)), {catalogue: {...CATALOGUE, IT_GUID: GUIDS}, signature: sig, relationSchemas: {IT_GUID: GUIDS}, tableFunctions: registry, strictColumns: true, ...options});

  it("binds the callee's declared RETURNS as the source's schema and its arguments as typed values", () => {
    const ir = call('lt = SELECT f.k, f.v FROM "CL_X=>GET_ROWS"(:iv_a, 1) AS f WHERE f.k = \'x\'; RETURN :lt;');
    const hana = lower(ir.rel, "hana");
    expect(hana.sql).to.match(/FROM \(SELECT \* FROM "CL_X=>GET_ROWS"\(\?, 1\)\) AS "F"/);
    expect(hana.params.map((p) => p.name)).to.deep.equal(["IV_A", "p1"]);
  });

  it("keeps the callee's name as the source spells it", () => {
    const ir = call('RETURN SELECT k FROM "cl_x=>get_rows"(:iv_a, 1);', {tableFunctions: {"CL_X=>GET_ROWS": registry["CL_X=>GET_ROWS"]}});
    expect(lower(ir.rel, "hana").sql).to.contain('"cl_x=>get_rows"(');
  });

  it("is refused by name on a dialect that has no such object", () => {
    const ir = call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(:iv_a, 1);');
    expect(() => lower(ir.rel, "duckdb")).to.throw(/CL_X=>GET_ROWS is not compiled for duckdb/);
    expect(() => lower(ir.rel, "sqlite")).to.throw(/not compiled for sqlite/);
  });

  it("refuses a callee the registry does not hold, an argument count that differs, and a system function", () => {
    expect(() => call('RETURN SELECT k FROM "CL_Y=>NOBODY"(:iv_a);')).to.throw(BindError, /table function call CL_Y=>NOBODY is not in the registry/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(:iv_a);')).to.throw(BindError, /takes 2 argument\(s\) \(iv_a, iv_n\) and is called with 1/);
    expect(() => call("RETURN SELECT k FROM sys.series_generate_date('INTERVAL 1 DAY', :iv_a, :iv_a);")).to.throw(BindError, /SYS.SERIES_GENERATE_DATE is a HANA system function/);
  });

  it("lets a trailing OPTIONAL or DEFAULT argument be left out, and still refuses too few or too many", () => {
    expect(call('RETURN SELECT k FROM "CL_X=>CONVERT"(:it_guid);').rel.input.args).to.have.length(1);
    expect(call('RETURN SELECT k FROM "CL_X=>CONVERT"(:it_guid, 1);').rel.input.args).to.have.length(2);
    expect(() => call('RETURN SELECT k FROM "CL_X=>CONVERT"();')).to.throw(BindError, /takes 1 to 2 argument\(s\) \(it_rows, iv_mode\?\) and is called with 0/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>CONVERT"(:it_guid, 1, 2);')).to.throw(BindError, /is called with 3/);
  });

  it("checks a scalar argument against the parameter's type, types a NULL argument by it, and refuses a parameter nobody typed", () => {
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(:iv_a, \'abc\');')).to.throw(BindError, /argument iv_n of CL_X=>GET_ROWS is C and the parameter is I/);
    const nulled = call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(NULL, 1);').rel.input.args[0].expr;
    expect(nulled).to.include({node: "lit", value: null});
    expect(nulled.type).to.deep.equal({abap: "STRING"});
    expect(nulled.untyped).to.equal(undefined);
    expect(() => call('RETURN SELECT k FROM "CL_X=>DARK"(1);')).to.throw(BindError, /argument iv_z of CL_X=>DARK has no resolved type \(CL_X=>DARK.iv_z: ZUNKNOWN/);
  });

  it("binds named arguments by the parameter's name, in any order, for a quoted or an unquoted callee", () => {
    const quoted = call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(iv_n => 1, iv_a => :iv_a);');
    expect(quoted.rel.input.args.map((a) => a.name)).to.deep.equal(["IV_A", "IV_N"]);
    const bare = call("RETURN SELECT k FROM CL_X=>GET_ROWS ( iv_a => :iv_a, iv_n => 2 );");
    expect(bare.rel.input.name).to.equal("CL_X=>GET_ROWS");
    expect(lower(bare.rel, "hana").sql).to.contain('"CL_X=>GET_ROWS"(');
    expect(call('RETURN SELECT k FROM "CL_X=>CONVERT"(it_rows => :it_guid);').rel.input.args).to.have.length(1);
  });

  it("refuses named arguments that are mixed, unknown, repeated, or leave out a required one", () => {
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(:iv_a, iv_n => 1);')).to.throw(BindError, /positional and named arguments together/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(iv_a => :iv_a, iv_z => 1);')).to.throw(BindError, /has no parameter iv_z/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(iv_a => :iv_a, iv_a => :iv_a);')).to.throw(BindError, /argument iv_a of CL_X=>GET_ROWS is given twice/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(iv_n => 1);')).to.throw(BindError, /argument iv_a of CL_X=>GET_ROWS is missing/);
    // a trailing required one left out is named the same way, not counted
    expect(() => call('RETURN SELECT k FROM "CL_X=>GET_ROWS"(iv_a => :iv_a);')).to.throw(BindError, /argument iv_n of CL_X=>GET_ROWS is missing/);
    // an optional one before a named one has no positional spelling yet
    expect(() => call('RETURN SELECT k FROM "CL_X=>GAPPED"(iv_req => 1);')).to.throw(BindError, /leaving out an optional argument before a named one is not lowered/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>GAPPED"(iv_opt => 1);')).to.throw(BindError, /argument iv_req of CL_X=>GAPPED is missing/);
  });

  it("binds a table argument to a table variable or an IN table parameter, and refuses anything else", () => {
    const ir = call('RETURN SELECT k FROM "CL_X=>CONVERT"(:it_guid);');
    expect(ir.rel.input.args[0]).to.include({kind: "relation", name: "IT_GUID"});
    expect(() => lower(ir.rel, "hana")).to.throw(/table-valued argument to CL_X=>CONVERT is not lowered yet/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>CONVERT"(:nobody);')).to.throw(BindError, /unknown table variable :nobody passed to CL_X=>CONVERT/);
    expect(() => call('RETURN SELECT k FROM "CL_X=>CONVERT"(1);')).to.throw(BindError, /argument it_rows of CL_X=>CONVERT is a table and must be a table variable/);
  });
});
