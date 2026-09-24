// The order pairs (tools/sqlscript-order-pairs.mjs) are current: a port of
// the order rule checks itself against test/fixtures/ir-pairs/order.ndjson,
// so the file must say what the code does. Rendering it also runs every
// ordered case on DuckDB, SQLite and sql.js and fails if they visit
// differently.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {PAIRS_FILE, render} from "../tools/sqlscript-order-pairs.mjs";

describe("the order pairs a port checks", function () {
  this.timeout(60000);
  it("are current (node tools/sqlscript-order-pairs.mjs writes them) and agree on three engines", async () => {
    expect(readFileSync(PAIRS_FILE, "utf8")).to.equal(await render());
  });
  it("hold every kind, the refusals among them", () => {
    const lines = readFileSync(PAIRS_FILE, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const kinds = new Set(lines.map((line) => line.kind));
    expect([...kinds].sort()).to.deep.equal(["header", "orderOf", "ordered", "procedure"]);
    expect(lines.some((line) => line.expect?.refused === "order")).to.equal(true);
  });
});
