import {expect} from "chai";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {toIr} from "../tools/sqlscript/to-ir.mjs";
import {adversarialRows} from "../tools/sqlscript-ir.mjs";

// The canary: bodies written by hand, put through the **real** front end, that
// make the divergence finder speak.
//
// It exists because the corpus run is silent and will stay silent for a
// while: the four bodies that qualify are projections, and everything with a
// cast or a division is still blocked in the grammar. An instrument that only
// ever says nothing is indistinguishable from one that has lost its voice, so
// these two bodies are here to keep the difference visible.
const CATALOGUE = {SRC: {K: {abap: "C", len: 4}, N: {abap: "I"}, TXT: {abap: "C", len: 10}, B: {abap: "I"}}};
const planOf = (body) => toIr(parse(new Body(), lex(body)), {catalogue: CATALOGUE}).rel;

describe("the divergence finder can still speak", () => {

  it("asks for the one row that makes a cast diverge, and says why", () => {
    const rows = adversarialRows(planOf("SELECT k, TO_INTEGER(txt) AS n FROM src;"), CATALOGUE.SRC);
    expect(rows, "it asked for something").to.not.have.length(0);
    const cast = rows.find((r) => /cast|convert|number/i.test(r.why ?? ""));
    expect(cast, `no row explained by a cast: ${JSON.stringify(rows)}`).to.not.equal(undefined);
    expect(cast.column, "and it named the column the cast reads").to.equal("TXT");
  });

  it("asks for a zero divisor, which is three different answers on three engines", () => {
    // HANA raises, DuckDB gives infinity, sql.js gives NULL
    // (docs/sqlscript-hana-observed.md)
    const rows = adversarialRows(planOf("SELECT k, n / b AS q FROM src;"), CATALOGUE.SRC);
    const zero = rows.find((r) => r.value === 0 || r.value === "0");
    expect(zero, `no zero divisor asked for: ${JSON.stringify(rows)}`).to.not.equal(undefined);
  });

  it("stays silent on a plan with nothing that can diverge, which is the other half", () => {
    // a finder that speaks on everything is as useless as one that never
    // does: the silence has to be earned
    expect(adversarialRows(planOf("SELECT k FROM src WHERE k = 'a';"), CATALOGUE.SRC)).to.have.length(0);
  });
});
