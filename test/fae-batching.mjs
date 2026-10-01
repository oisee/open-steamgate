import {expect} from "chai";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RELINK, STALE, batchesFae, faeStatements, syOf, requireBatchedFae} from "./helpers/fae-batching.mjs";

// test/helpers/fae-batching.mjs: the guard that turns "expected 4 to equal 1"
// on a tree with the published packages into the instruction to relink.
describe("FAE batching guard", function () {
  this.timeout(60000);

  it("passes when the tree batches FOR ALL ENTRIES", async () => {
    await requireBatchedFae(undefined, [], async () => true);
  });

  it("fails, not skips, with the relink instruction when it does not", async () => {
    let error;
    try {
      await requireBatchedFae(undefined, [], async () => false);
    } catch (e) {
      error = e;
    }
    expect(error, "a published runtime must fail the hook").to.be.instanceOf(Error);
    expect(error.message).to.match(/^relink the pinned transpiler .*npm run transpiler:local.*npm run runtime:local.*npm run transpile\)$/);
    expect(error.message).to.equal(RELINK);
  });

  it("fails with the rebuild instruction when output/ lacks the block loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fae-batching-"));
    try {
      const per = join(dir, "per.mjs");
      const blocked = join(dir, "blocked.mjs");
      writeFileSync(per, "for (const r of rows) await select(r);");
      writeFileSync(blocked, "const w = rows.slice(i, i + 50).map(f);");
      let error;
      try { await requireBatchedFae(undefined, [blocked, per], async () => true); } catch (e) { error = e; }
      expect(error?.message).to.equal(STALE);
      await requireBatchedFae(undefined, [blocked], async () => true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("leaves sy as it found it (a frozen clock, a client, a counter)", async () => {
    const sy = syOf().get();
    const want = {mandt: "456", datum: "20260101", uzeit: "123456", subrc: 4, index: 7, tabix: 9};
    const was = Object.fromEntries(Object.keys(want).map((k) => [k, sy[k].get()]));
    for (const [k, v] of Object.entries(want)) sy[k].set(v);
    try {
      await faeStatements();
      for (const [k, v] of Object.entries(want)) expect(String(sy[k].get()), k).to.equal(String(v));
    } finally {
      for (const [k, v] of Object.entries(was)) sy[k].set(v);
    }
  });

  it("raises the mocha timeout of the hook that asks, the probe transpiles", async () => {
    let asked;
    const context = {timeout: (ms) => { if (ms === undefined) return 2000; asked = ms; return context; }};
    await requireBatchedFae(context, [], async () => true);
    expect(asked).to.be.at.least(60000);
  });

  it("the real probe counts statements and gives back the global it borrowed", async () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "abap");
    const statements = await faeStatements();
    expect(Object.getOwnPropertyDescriptor(globalThis, "abap")).to.deep.equal(before);
    // 120 driving rows: one per row (published) or three blocks of 50 (the pin)
    expect(statements).to.be.oneOf([120, 3]);
    expect(await batchesFae()).to.equal(statements < 120);
  });
});
