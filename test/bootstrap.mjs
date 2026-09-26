import {expect} from "chai";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describeVsixPreflight, githubWorkflowEnv, librariesFromLock, readLock} from "../tools/osd-lock.mjs";
import {nodeVersionProblem, requireSupportedNode} from "../tools/osd-node-version.mjs";
import {packsOf} from "../tools/osd-packs.mjs";
import {approvedLicenseAssumption} from "../docker/image/license-assumptions.mjs";

const ROOT = process.cwd();

describe("fresh checkout bootstrap", () => {
  it("reads one pinned repo and commit for each configured library", () => {
    const {lock, libraries} = librariesFromLock(ROOT);
    const config = JSON.parse(readFileSync(join(ROOT, "abap_transpile.json"), "utf8"));
    expect(lock).to.deep.equal(readLock(ROOT));
    expect(libraries.map((lib) => lib.folder)).to.deep.equal(
      config.libs.map((lib) => lib.folder.replace(/^\//, "")),
    );
    expect(libraries).to.have.length(lock.libraries.length);
    for (const lib of libraries) {
      expect(lib.ref).to.match(/^[0-9a-f]{40}$/);
      expect(lib.url).to.equal(`https://github.com/${lib.repo}.git`);
      expect(lib.path).to.equal(join(ROOT, lib.folder));
    }
  });

  it("exports the transpiler pin from the same lock for workflows", () => {
    const {transpiler} = readLock(ROOT);
    expect(githubWorkflowEnv(ROOT)).to.equal(
      `OSD_TRANSPILER_REPO=https://github.com/${transpiler.repo}.git\nOSD_TRANSPILER_REF=${transpiler.ref}\n`,
    );
  });

  it("keeps the Docker source inventory aligned with the locked library list", () => {
    const {lock} = librariesFromLock(ROOT);
    const sources = JSON.parse(readFileSync(join(ROOT, "docker", "image", "sources.json"), "utf8"));
    expect(sources.libraries.map((lib) => lib.folder).sort()).to.deep.equal(
      lock.libraries.map((lib) => lib.folder).sort(),
    );
    for (const lib of sources.libraries) {
      expect(lib).not.to.have.property("repo");
      expect(lib).not.to.have.property("ref");
    }
  });

  it("resolves the GUI examples pack to the library's locked commit", () => {
    const lock = readLock(ROOT);
    const gui = lock.libraries.find((lib) => lib.folder === "open-abap-gui");
    const pack = packsOf(ROOT).find((entry) => entry.name === "gui-examples");
    expect(pack.sources[0]).to.include({
      repo: `https://github.com/${gui.repo}.git`,
      ref: gui.ref,
    });
  });

  it("refuses Node releases missing required open-rfc or unflagged node:sqlite support", () => {
    for (const version of ["22.14.0", "22.99.0", "23.4.0", "24.0.0", "24.99.99", "26.9.0"]) {
      expect(nodeVersionProblem(version), version).to.equal(undefined);
    }
    for (const version of ["20.0.0", "22.9.0", "22.13.99", "23.0.0", "23.3.99", "not-a-version"]) {
      expect(nodeVersionProblem(version), version).to.be.a("string");
    }
  });

  it("warns once and continues for Node versions outside open-rfc's tested engines", () => {
    const warnings = [];
    for (const version of ["22.14.0", "24.0.0"]) {
      expect(() => requireSupportedNode(version, "bootstrap: ", (line) => warnings.push(line))).not.to.throw();
    }
    expect(warnings).to.deep.equal([]);
    for (const version of ["23.4.0", "25.0.0", "26.9.0"]) {
      expect(() => requireSupportedNode(version, "bootstrap: ", (line) => warnings.push(line))).not.to.throw();
    }
    expect(warnings).to.deep.equal(["23.4.0", "25.0.0", "26.9.0"].map(
      (version) => `bootstrap: Node ${version} is untested with open-rfc engines ^22.14||^24`,
    ));
    expect(() => requireSupportedNode("22.9.0", "build-vsix: ", (line) => warnings.push(line)))
      .to.throw("build-vsix: Node 22.9.0 is unsupported");
    expect(warnings).to.have.length(3);
  });

  it("turns missing VSIX prerequisites into one bootstrap instruction", () => {
    const message = describeVsixPreflight(["node_modules/", ".local/lars/open-abap-core/", "gen/"]);
    expect(message).to.equal(
      "build-vsix: missing node_modules/, .local/lars/open-abap-core/, gen/; run npm run bootstrap",
    );
    expect(message).not.to.contain("\n");
    expect(describeVsixPreflight([])).to.equal(undefined);
  });

  it("limits temporary image license approvals to the reviewed fork commits", () => {
    const lock = readLock(ROOT);
    const sources = JSON.parse(readFileSync(join(ROOT, "docker", "image", "sources.json"), "utf8"));
    for (const source of sources.libraries.filter((lib) => lib.licenseAssumption)) {
      const pin = lock.libraries.find((lib) => lib.folder === source.folder);
      const reviewed = {...pin, ...source};
      expect(approvedLicenseAssumption(reviewed), source.folder).to.equal(true);
      expect(approvedLicenseAssumption({...reviewed, ref: "0".repeat(40)}), source.folder).to.equal(false);
      expect(approvedLicenseAssumption({...reviewed, repo: "elsewhere/" + source.folder}), source.folder).to.equal(false);
      expect(approvedLicenseAssumption({...reviewed, licenseAssumption: {license: "Apache-2.0"}}), source.folder).to.equal(false);
    }
  });
});
