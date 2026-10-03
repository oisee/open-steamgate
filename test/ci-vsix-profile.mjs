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
    expect(needsFullVsix(["test/vscode-vsix-packaging.mjs"], before, before)).to.equal(true);
    expect(needsFullVsix(["test/helpers/vsix.mjs"], before, before)).to.equal(true);
    expect(needsFullVsix(["packs/zork/games/zork1-z3.w3mi.data.z3"], before, before)).to.equal(true);
  });

  it("checks a missing manifest in full", () => {
    expect(needsFullVsix(["editors/vscode/package.json"], undefined, before)).to.equal(true);
  });

  for (const path of [
    "src/adt/zcl_x.clas.testclasses.abap",
    "src/foo.clas.abap",
    "webapp/x.js",
    "tools/x.mjs",
    "data/x.tabu.json",
    "packs/other/src/foo.clas.abap",
    "abap_transpile.json",
    "abaplint.jsonc",
    "libs.lock.json",
    "package.json",
    // test/ ships except the staging exclusions: even this JS is payload.
    "test/x.mjs",
    "test/setup.mjs",
    "test/unit/zcl_x.clas.testclasses.abap",
  ]) {
    it(`checks shipped seed content in full: ${path}`, () => {
      expect(needsFullVsix([path], before, before)).to.equal(true);
    });
  }

  for (const path of [
    "docs/x.md",
    "gen/x.clas.abap", // regenerated inside the seed, never copied
    "test/e2e/x.mjs",
    "test/fixtures/x.clas.abap",
    "test/unit/zcl_osd_adt_session_mem.clas.abap",
    "test/unit/zcl_osd_adt_route_f2.clas.testclasses.abap",
    "test/integration/zosd_voyage.prog.abap",
    "src-other/foo.clas.abap",
  ]) {
    it(`keeps unshipped content fast: ${path}`, () => {
      expect(needsFullVsix([path], before, before)).to.equal(false);
    });
  }
});
