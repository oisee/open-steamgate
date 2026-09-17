// Base images: the first runtime over a new DDIC seeds and leaves an image;
// the next one over a fresh file is a copy of it. And a detached unit run
// never touches the rows the application serves.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readdirSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";

const boot = (env) => spawnSync(process.execPath, ["--input-type=module", "-e",
  `const {initializeABAP} = await import(${JSON.stringify(new URL("../output/init.mjs", import.meta.url).href)}); await initializeABAP(); const db = globalThis.abap.context.databaseConnections.DEFAULT; console.log(JSON.stringify({stamp: await db.stampedSchema(), path: db.path})); await db.disconnect();`],
  {encoding: "utf8", cwd: process.cwd(), env: {...process.env, STG_DB: "file", ...env}});

describe("tools/osd-db: base images and forks", function () {
  this.timeout(120000);
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), "osd-base-")); });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("the first boot over a new DDIC seeds and leaves a base image; the second copies it", () => {
    const base = join(dir, "base");
    const first = boot({STG_DB_PATH: join(dir, "one.sqlite"), STG_DB_BASE: base});
    expect(first.status, first.stderr).to.equal(0);
    const {stamp} = JSON.parse(first.stdout.trim().split("\n").pop());
    expect(stamp).to.match(/^[0-9a-f]{16}$/);
    // the image is named by the schema and the rows that went into it, not
    // by the stamp alone (B.13): there is one, whatever its name
    const images = readdirSync(base).filter((f) => f.endsWith(".sqlite"));
    expect(images, "the image is there after the first boot").to.have.length(1);
    const image = join(base, images[0]);
    const before = statSync(image).mtimeMs;
    const t0 = Date.now();
    const second = boot({STG_DB_PATH: join(dir, "two.sqlite"), STG_DB_BASE: base});
    expect(second.status, second.stderr).to.equal(0);
    expect(statSync(image).mtimeMs, "the image is reused, not remade").to.equal(before);
    const two = new DatabaseSync(join(dir, "two.sqlite"), {readOnly: true});
    expect(two.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint, "the copy carries the stamp").to.equal(stamp);
    expect(two.prepare("SELECT COUNT(*) AS n FROM zstg_demo").get().n, "and the mandatory rows").to.be.greaterThan(0);
    two.close();
    expect(Date.now() - t0, "a copy, so a boot well under the seed's time").to.be.lessThan(15000);
  });

  it("a detached unit run gets a file of its own and leaves nothing behind", async () => {
    const {ObjectStore} = await import("../tools/osd-store.mjs");
    const {UnitRun} = await import("../tools/osd-unit.mjs");
    const store = new ObjectStore();
    const runner = new UnitRun(store);
    const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith("osd-unit-") && n.endsWith(".sqlite"));
    const before = leftovers().length;
    const result = await runner.runDetached("CLAS", "ZCL_ZOSD_TEST_DEMO");
    expect(result, "the run answered").to.be.an("object");
    expect(leftovers().length, "its database went with it").to.equal(before);
  });
});
