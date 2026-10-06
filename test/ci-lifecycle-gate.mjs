import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {needsLifecycle} from "../tools/osd-ci-lifecycle-gate.mjs";

const gate = fileURLToPath(new URL("../tools/osd-ci-lifecycle-gate.mjs", import.meta.url));

// A throwaway git repository, so the CLI's git diff can be driven for real.
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ci-lifecycle-gate-"));
  const git = (...args) => execFileSync("git", args, {cwd: dir, encoding: "utf8"});
  git("init", "-q");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "CI");
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD").trim();
  };
  return {dir, git, commit};
}

function runGate(dir, base, head) {
  return execFileSync(process.execPath, [gate, base, head], {cwd: dir, encoding: "utf8"});
}

describe("CI ADT lifecycle gate", () => {
  it("keeps a docs-only change set skipped", () => {
    expect(needsLifecycle(["docs/ci-tests.md", "docs/adt-lifecycle.md", "ANORMALIES.md", "AGENDA.md", "README.md", "CLAUDE.md"]))
      .to.equal(false);
  });

  it("keeps markdown elsewhere outside src/ skipped", () => {
    expect(needsLifecycle(["editors/vscode/CHANGELOG.md", "tools/abapfs-conformance/README.md", ".github/pull_request_template.md"]))
      .to.equal(false);
  });

  it("runs for markdown under src/", () => {
    expect(needsLifecycle(["src/readme.md"])).to.equal(true);
  });

  it("keeps a webapp-only change set skipped", () => {
    expect(needsLifecycle(["webapp/x.js", "webapp/controller/List.view.xml"])).to.equal(false);
  });

  it("keeps an e2e-only change set skipped", () => {
    expect(needsLifecycle(["test/e2e/listreport.spec.mjs", "test/e2e/fixtures/launchpad.json"])).to.equal(false);
  });

  it("keeps an editors/vscode source change skipped", () => {
    expect(needsLifecycle(["editors/vscode/extension.js", "editors/vscode/src/system-overview.js"])).to.equal(false);
  });

  it("runs for the editors/vscode launcher and shipped resources", () => {
    expect(needsLifecycle(["editors/vscode/launcher.js"])).to.equal(true);
    expect(needsLifecycle(["editors/vscode/resources/walkthroughs/osd.json"])).to.equal(true);
  });

  it("runs for other workflow and repo-meta files", () => {
    expect(needsLifecycle([".github/workflows/tests.yml"])).to.equal(true);
    expect(needsLifecycle([".gitignore"])).to.equal(true);
  });

  it("keeps other workflows, issue templates and the license skipped", () => {
    expect(needsLifecycle([".github/workflows/release.yml"])).to.equal(false);
    expect(needsLifecycle([".github/ISSUE_TEMPLATE/bug.md"])).to.equal(false);
    expect(needsLifecycle(["LICENSE"])).to.equal(false);
  });

  it("runs for sources, runtime tools, tests, scripts and CI pins", () => {
    expect(needsLifecycle(["src/adt/zcl_osd_adt_session.clas.abap"])).to.equal(true);
    expect(needsLifecycle(["src/gateway/zcl_osd_dispatcher.clas.abap"])).to.equal(true);
    expect(needsLifecycle(["src/icf/nodes.json"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-runtime.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/osd-host.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/adt-lifecycle.mjs"])).to.equal(true);
    expect(needsLifecycle(["tools/abapfs-conformance/package.json"])).to.equal(true);
    expect(needsLifecycle(["test/start.mjs"])).to.equal(true);
    expect(needsLifecycle(["test/setup.mjs"])).to.equal(true);
    expect(needsLifecycle(["test/suites.d/adt.json"])).to.equal(true);
    expect(needsLifecycle(["scripts/build-vsix.mjs"])).to.equal(true);
    expect(needsLifecycle(["scripts/build-binary.mjs"])).to.equal(true);
    expect(needsLifecycle(["bin/osd.mjs"])).to.equal(true);
    expect(needsLifecycle(["packs/zork/zdemo_pack.wapa.xml"])).to.equal(true);
    expect(needsLifecycle(["data/whatever.json"])).to.equal(true);
    expect(needsLifecycle(["package.json", "libs.lock.json", "abap_transpile.json"])).to.equal(true);
    expect(needsLifecycle([".github/ci/vsp.ref"])).to.equal(true);
  });

  it("fails closed for unknown paths", () => {
    expect(needsLifecycle(["some/new/directory/thing.mjsx"])).to.equal(true);
    expect(needsLifecycle([".github/workflows/nested/thing.yml"])).to.equal(true);
  });

  it("keeps an empty diff skipped", () => {
    expect(needsLifecycle([])).to.equal(false);
  });

  it("runs for a mixed docs-and-tools change set", () => {
    expect(needsLifecycle(["docs/x.md", "README.md", "tools/osd-runtime.mjs"])).to.equal(true);
  });

  it("CLI: a rename out of src/adt into an exempt-looking directory runs", () => {
    const {dir, commit, git} = tempRepo();
    try {
      mkdirSync(join(dir, "src", "adt"), {recursive: true});
      writeFileSync(join(dir, "src", "adt", "zcl_osd_adt_session.clas.abap"), "class zcl_osd_adt_session definition.\nendclass.\n");
      const base = commit("initial");
      mkdirSync(join(dir, "webapp"), {recursive: true});
      // A plain rename; git's default rename detection would report only
      // the webapp destination, and the old allowlist-style rule skipped.
      git("mv", "src/adt/zcl_osd_adt_session.clas.abap", "webapp/zcl_osd_adt_session.clas.abap");
      const head = commit("move the ADT session away");
      expect(runGate(dir, base, head)).to.equal("OSD_CI_ADT_LIFECYCLE=1\n");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("CLI: a docs-only commit skips", () => {
    const {dir, commit} = tempRepo();
    try {
      writeFileSync(join(dir, "README.md"), "# readme\n");
      const base = commit("initial");
      mkdirSync(join(dir, "docs"), {recursive: true});
      writeFileSync(join(dir, "docs", "ci-tests.md"), "text\n");
      const head = commit("document");
      expect(runGate(dir, base, head)).to.equal("OSD_CI_ADT_LIFECYCLE=0\n");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("CLI: an empty diff skips", () => {
    const {dir, commit} = tempRepo();
    try {
      mkdirSync(join(dir, "docs"), {recursive: true});
      writeFileSync(join(dir, "docs", "x.md"), "x");
      const base = commit("initial");
      expect(runGate(dir, base, base)).to.equal("OSD_CI_ADT_LIFECYCLE=0\n");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
