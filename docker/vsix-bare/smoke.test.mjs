import {test} from "node:test";
import assert from "node:assert/strict";
import {parseArgs, releaseAsset, verifyChecksum} from "./smoke.mjs";

test("rejects ambiguous input and incomplete flags before any Docker work", () => {
  assert.throws(() => parseArgs(["--vsix", "x", "--release", "v1"]), /choose/);
  assert.throws(() => parseArgs(["--layer"]), /incomplete/);
  assert.throws(() => parseArgs(["--release", "--layer", "x"]), /incomplete/);
  assert.throws(() => parseArgs(["--vsix", "x", "--vsix", "y"]), /duplicate/);
  assert.throws(() => parseArgs(["--unknown"]), /unknown/);
  assert.deepEqual(parseArgs(["--vsix", "a b.vsix", "--layer", "layer", "--skip-image-build"]),
    {vsix: "a b.vsix", layer: "layer", "skip-image-build": true});
});

test("release selection refuses missing, ambiguous or unchecked VSIX assets", () => {
  assert.throws(() => releaseAsset({assets: []}), /found 0/);
  assert.throws(() => releaseAsset({assets: [{name: "a.vsix"}]}), /no .sha256/);
  assert.throws(() => releaseAsset({assets: [{name: "a.vsix"}, {name: "b.vsix"}]}), /found 2/);
  const assets = [{name: "a.vsix"}, {name: "a.vsix.sha256"}, {name: "osd-linux-x64"}];
  assert.deepEqual(releaseAsset({assets}), {vsix: assets[0], checksum: assets[1]});
});

test("checks both checksum bytes and exact asset name, refusing extra entries", () => {
  const digest = "a".repeat(64);
  verifyChecksum(`${digest}  a.vsix\n`, "a.vsix", digest);
  verifyChecksum(`${digest.toUpperCase()} *a.vsix\r\n`, "a.vsix", digest);
  assert.throws(() => verifyChecksum(`${"b".repeat(64)}  a.vsix`, "a.vsix", digest), /verification failed/);
  assert.throws(() => verifyChecksum(`${digest}  other.vsix`, "a.vsix", digest), /verification failed/);
  assert.throws(() => verifyChecksum(`${digest}  a.vsix\n${digest}  other.vsix`, "a.vsix", digest), /exactly one/);
});
