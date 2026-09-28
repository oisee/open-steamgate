import {expect} from "chai";
import {needsFullVsix} from "../tools/osd-ci-vsix-profile.mjs";

describe("CI VSIX profile", () => {
  const before = {version: "0.2.0", main: "extension.js", browser: "dist/web/extension.js", contributes: {menus: {}}};

  it("keeps menu-only web changes in the fast profile", () => {
    const after = {...before, contributes: {menus: {"view/title": []}}};
    expect(needsFullVsix(["editors/vscode/package.json", "editors/vscode/web/extension.mjs"], before, after)).to.equal(false);
  });

  it("checks a package identity or payload change in full", () => {
    expect(needsFullVsix(["editors/vscode/package.json"], before, {...before, version: "0.3.0"})).to.equal(true);
    expect(needsFullVsix(["scripts/build-vsix.mjs"], before, before)).to.equal(true);
    expect(needsFullVsix(["packs/zork/games/zork1-z3.w3mi.data.z3"], before, before)).to.equal(true);
  });

  it("checks a missing manifest in full and ignores unrelated code", () => {
    expect(needsFullVsix(["editors/vscode/package.json"], undefined, before)).to.equal(true);
    expect(needsFullVsix(["src/gateway/zcl_stg_gateway.clas.abap"], before, before)).to.equal(false);
  });
});
