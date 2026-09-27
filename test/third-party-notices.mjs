import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {inventoryThirdParties, writeThirdPartyNotices} from "../scripts/third-party-notices.mjs";

describe("VSIX staged third-party notices", function () {
  it("verifies the committed Zork I story against its build record offline", function () {
    expect(execFileSync(process.execPath, ["scripts/zork-story-check.mjs"], {encoding: "utf8"}))
      .to.contain("Zork I story verified: 86928 bytes");
  });
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
  it("records the maintainer's MIT override for open-abap-gui and its converter verbatim", function () {
    const root = mkdtempSync(join(tmpdir(), "osd-gui-notice-"));
    const seed = join(root, "seed");
    const path = ".local/lars/open-abap-gui";
    const note = "LICENSE file reads 'todo', package.json licence empty, converter/ without a licence; treated as MIT by the open-steamgate maintainer, 2026-09-27";
    try {
      mkdirSync(join(seed, path), {recursive: true});
      mkdirSync(join(root, path), {recursive: true});
      writeFileSync(join(seed, "libs.lock.json"), JSON.stringify({libraries: [{folder: "open-abap-gui"}]}));
      writeFileSync(join(root, path, "LICENSE"), "todo\n");
      const report = inventoryThirdParties(seed, root);
      expect(report.entries[0]).to.include({id: "MIT", note});
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it("includes the Microsoft story license only when the rebuilt story is staged", function () {
    const root = mkdtempSync(join(tmpdir(), "osd-zork-notice-"));
    const seed = join(root, "seed");
    const story = "packs/zork/src/zork1-z3.w3mi.data.z3";
    const license = "packs/zork/ZORK1-LICENSE.txt";
    try {
      mkdirSync(join(seed, "packs/zork/src"), {recursive: true});
      mkdirSync(join(root, "packs/zork"), {recursive: true});
      writeFileSync(join(seed, "libs.lock.json"), JSON.stringify({libraries: []}));
      writeFileSync(join(seed, story), "story bytes");
      const original = readFileSync(new URL("../packs/zork/ZORK1-LICENSE.txt", import.meta.url), "utf8");
      writeFileSync(join(root, license), original);
      const out = join(root, "THIRD-PARTY-NOTICES.md");
      writeThirdPartyNotices(seed, out, root);
      const notice = readFileSync(out, "utf8");
      expect(notice).to.contain("## Zork I story — packs/zork/src/zork1-z3.w3mi.data.z3");
      expect(notice).to.contain(original.trim());
      expect(notice).to.contain("Source release by Microsoft, 2025; no trademark rights are granted; rebuilt from the MIT-licensed ZIL source, not the historical binary");
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
  it("includes the pinned oisee/zork-abap MIT notice when interpreter sources are staged", function () {
    const root = mkdtempSync(join(tmpdir(), "osd-zork-abap-notice-"));
    const seed = join(root, "seed");
    try {
      mkdirSync(join(seed, "packs/zork/upstream"), {recursive: true});
      mkdirSync(join(seed, "packs/zork/games"), {recursive: true});
      writeFileSync(join(seed, "packs/zork/upstream/interpreter.abap"), "CLASS interpreter DEFINITION. ENDCLASS.");
      writeFileSync(join(seed, "packs/zork/games/replay.txt"), "look\n");
      writeFileSync(join(seed, "libs.lock.json"), JSON.stringify({libraries: []}));
      const report = inventoryThirdParties(seed, root);
      const entry = report.entries.find((item) => item.path === "packs/zork/upstream");
      expect(entry).to.include({name: "oisee/zork-abap interpreter", id: "MIT"});
      expect(createHash("sha256").update(entry.licenseText).digest("hex"))
        .to.equal("3bed3331b7048bac17cf50e249d560ccc9508c970da8d7b9283bf4f2e633a91d");
      const out = join(root, "THIRD-PARTY-NOTICES.md");
      writeThirdPartyNotices(seed, out, root);
      const notice = readFileSync(out, "utf8");
      expect(notice).to.contain("## oisee/zork-abap interpreter — packs/zork/upstream");
      expect(notice).to.contain("Covers fetched folders: packs/zork/upstream, packs/zork/games.");
      expect(notice).to.contain(entry.licenseText);
      expect(notice).to.contain("0c8d96b908f88fc3207e7f9a00bc43f724b32b6f");
      rmSync(join(seed, "packs/zork/games"), {recursive: true});
      const withoutGames = inventoryThirdParties(seed, root).entries.find((item) => item.name === "oisee/zork-abap interpreter");
      expect(withoutGames.note).to.contain("Covers fetched folders: packs/zork/upstream.");
      expect(withoutGames.note).not.to.contain("packs/zork/games");
    } finally { rmSync(root, {recursive: true, force: true}); }
  });
});
