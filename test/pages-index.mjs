import {expect} from "chai";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {previewDirectories, renderPreviewIndex} from "../scripts/pages-index.mjs";

describe("GitHub Pages preview index", () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "osd-pages-index-"));
    for (const directory of ["main", "pr-7", "pr-42", "pr-bad", "notes"]) {
      await mkdir(join(root, directory, "app"), {recursive: true});
    }
    for (const directory of ["main", "pr-7", "pr-42"]) {
      await writeFile(join(root, directory, "app", "flp.html"), directory);
    }
    await mkdir(join(root, "pr-42", "screenshots"), {recursive: true});
    await writeFile(join(root, "pr-42", "screenshots", "list-report.png"), "shots");
  });

  afterEach(async () => rm(root, {recursive: true, force: true}));

  it("lists every real deployment, main first and PRs newest first", async () => {
    expect(await previewDirectories(root)).to.deep.equal(["main", "pr-42", "pr-7"]);
  });

  it("links straight to each launchpad and only existing screenshots", async () => {
    const html = await renderPreviewIndex(root);
    expect(html).to.contain('href="main/app/flp.html"');
    expect(html).to.contain('href="pr-42/app/flp.html"');
    expect(html).to.contain('href="pr-7/app/flp.html"');
    expect(html).to.contain('href="pr-42/screenshots/list-report.png"');
    expect(html).not.to.contain('href="pr-7/screenshots/list-report.png"');
    expect(html).not.to.contain("pr-bad");
  });
});
