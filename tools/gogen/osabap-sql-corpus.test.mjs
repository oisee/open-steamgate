// The Open SQL forms the native build does not compile yet, pinned by name:
// a form the Go generator learns moves from REFUSED to compiled, and this
// list must shrink with it (foreman-dell's batch after U3 wave 3 aims at
// 18/18). A form that stops compiling fails here as well.
import test from "node:test";
import assert from "node:assert/strict";
import {compileCase, corpusCases} from "./osabap-sql-corpus.mjs";

const REFUSED = {
  "01": /aggregate and no GROUP BY/,
  "05": /SELECT form/,
  "08": /SELECT form/,
  "09": /SORTED table/,
  "11": /SELECT loop form/,
  "13": /undefined tables/,
};

test("the Open SQL corpus: which forms the native build compiles", async () => {
  const cases = corpusCases();
  assert.equal(cases.length, 18);
  for (const entry of cases) {
    const result = await compileCase(entry);
    if (REFUSED[entry.id]) {
      assert.equal(result.compiled, false, `${entry.id} ${entry.title} compiles now: take it off REFUSED`);
      assert.match(result.reason, REFUSED[entry.id], `${entry.id} ${entry.title}`);
    } else {
      assert.equal(result.compiled, true, `${entry.id} ${entry.title}: ${result.reason}`);
    }
  }
});
