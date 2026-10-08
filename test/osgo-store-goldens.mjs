import assert from "node:assert/strict";
import {check} from "../tools/osgo-store-goldens.mjs";

describe("OSGo store destination goldens", () => {
  it("regenerates the recorded destination answers without drift", async () => {
    const result = await check();
    assert.equal(result.ok, true);
  });
});
