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

describe("a table without an alias is its own qualifier", () => {
  it("resolves src.k when src is the one source of that name", () => {
    expect(sql("SELECT src.mandt AS client, src.k FROM src;")).to.contain('"SRC"."MANDT"');
    expect(sql("SELECT src.k, other.m FROM src INNER JOIN other ON src.k = other.k;")).to.contain('"OTHER"."M"');
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

  it("refuses a CASE whose every branch is NULL, and the BOOLEAN literals, by name", () => {
    expect(() => bind("SELECT CASE WHEN n > 1 THEN NULL ELSE NULL END AS v FROM src;")).to.throw(BindError, /every branch is NULL/);
    expect(() => bind("SELECT TRUE AS v FROM src;")).to.throw(BindError, /BOOLEAN literal TRUE is not portable yet/);
  });
});

describe("ORDER BY sees the projection's aliases", () => {
  it("sorts by a window column named in the same SELECT", () => {
    const text = sql("SELECT k, row_number() OVER (PARTITION BY k ORDER BY n) AS row_nr FROM src ORDER BY k, row_nr DESC;");
    expect(text).to.match(/ORDER BY "K" ASC, "ROW_NR" DESC/);
  });

  it("still refuses a key that is neither a source column nor an alias", () => {
    expect(() => bind("SELECT k FROM src ORDER BY nobody;")).to.throw(BindError, /column NOBODY is not present/);
  });
});
