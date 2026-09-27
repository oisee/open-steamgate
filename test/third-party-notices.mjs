import {expect} from "chai";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {inventoryThirdParties, writeThirdPartyNotices} from "../scripts/third-party-notices.mjs";

describe("VSIX staged third-party notices", function () {
  it("covers each staged package, including nested copies, and flags placeholder licences", function () {
    const root = mkdtempSync(join(tmpdir(), "osd-notices-"));
    const seed = join(root, "seed");
    const make = (path, value) => {
      mkdirSync(join(root, path), {recursive: true});
      writeFileSync(join(root, path, "package.json"), JSON.stringify(value));
    };
    try {
      mkdirSync(seed);
      writeFileSync(join(seed, "libs.lock.json"), JSON.stringify({libraries: [{folder: "unclear"}]}));
      make(".local/lars/unclear", {name: "unclear", license: ""});
      writeFileSync(join(root, ".local/lars/unclear/LICENSE"), "todo\n");
      mkdirSync(join(seed, ".local/lars/unclear"), {recursive: true});
      make("seed/node_modules/outer", {name: "outer", version: "1", license: "MIT"});
      make("seed/node_modules/outer/node_modules/inner", {name: "inner", version: "1", license: "ISC"});
      const report = inventoryThirdParties(seed, root);
      expect(report.entries.map((e) => e.name)).to.deep.equal(["unclear", "outer", "inner"]);
      expect(report.issues.some((issue) => issue.includes("unclear"))).to.equal(true);
      const out = join(root, "THIRD-PARTY-NOTICES.md");
      writeThirdPartyNotices(seed, out, root);
      const notices = readFileSync(out, "utf8");
      for (const entry of report.entries) expect(notices).to.contain(`## ${entry.name} — ${entry.path}`);
      expect(notices).to.contain("todo");
    } finally { rmSync(root, {recursive: true, force: true}); }
  });

  it("records the maintainer's MIT override for open-abap-odata verbatim", function () {
    const root = mkdtempSync(join(tmpdir(), "osd-odata-notice-"));
    const seed = join(root, "seed");
    const path = ".local/lars/open-abap-odata";
    const note = "LICENSE file reads 'todo'; the author's intent is MIT; treated as MIT by the open-steamgate maintainer, 2026-09-27";
    try {
      mkdirSync(join(seed, path), {recursive: true});
      mkdirSync(join(root, path), {recursive: true});
      writeFileSync(join(seed, "libs.lock.json"), JSON.stringify({libraries: [{folder: "open-abap-odata"}]}));
      writeFileSync(join(root, path, "LICENSE"), "todo\n");
      const report = inventoryThirdParties(seed, root);
      expect(report.entries[0]).to.include({id: "MIT", note});
      const out = join(root, "THIRD-PARTY-NOTICES.md");
      writeThirdPartyNotices(seed, out, root);
      expect(readFileSync(out, "utf8")).to.contain(`License: MIT (maintainer override).\n\nNote: ${note}`);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});
