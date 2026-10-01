import {expect} from "chai";
import {RELINK, batchesFae, faeStatements, requireBatchedFae} from "./helpers/fae-runtime.mjs";

// test/helpers/fae-runtime.mjs: the guard that turns "expected 4 to equal 1"
// on a tree with the published packages into the instruction to relink.
describe("FAE runtime guard", function () {
  this.timeout(60000);

  it("passes when the tree batches FOR ALL ENTRIES", async () => {
    await requireBatchedFae(undefined, async () => true);
  });

  it("fails, not skips, with the relink instruction when it does not", async () => {
    let error;
    try {
      await requireBatchedFae(undefined, async () => false);
    } catch (e) {
      error = e;
    }
    expect(error, "a published runtime must fail the hook").to.be.instanceOf(Error);
    expect(error.message).to.equal("relink the pinned runtime (published @abaplint/runtime runs FOR ALL ENTRIES per row): TRANSPILER=<fork> node tools/osd-link.mjs runtime packages/runtime");
    expect(error.message).to.equal(RELINK);
  });

  it("raises the mocha timeout of the hook that asks, the probe transpiles", async () => {
    let asked;
    const context = {timeout: (ms) => { if (ms === undefined) return 2000; asked = ms; return context; }};
    await requireBatchedFae(context, async () => true);
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
