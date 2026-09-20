// The registry as rows in a real database, applied by the rule.
import {expect} from "chai";
import {EDITED, applyTo, contentHash, currentOrigins, currentRows, keyOf, markEdited} from "../tools/osd-icf-apply.mjs";
import {icfRows} from "../tools/osd-icf-rows.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {readFileSync} from "node:fs";

// The four falsifications `docs/registry-drift.md` ends with, run against
// the database rather than over a plan. The plan is checked separately in
// test/osd-icf-apply.mjs; this is the other half -- that carrying it out
// leaves the rows the plan said it would, which a pure function cannot tell
// you.
describe("the ICF registry, applied to a database", function () {
  this.timeout(60000);
  const database = new FileSqliteClient({path: ":memory:"});
  const client = () => database;
  const objects = () => icfRows(".");

  // A real private database with the generated DDIC schema. Never clear the
  // runtime's DEFAULT connection: environment variables may point it at a
  // persistent database or another backend used by the developer.
  before(async () => {
    const source = readFileSync(new URL("../output/init.mjs", import.meta.url), "utf8");
    const schema = [...source.matchAll(/sqlite\.push\(`(CREATE TABLE '(?:icfservice|icfhandler|icfdocu|zosd_icf_origin|zosd_icf_aside|zosd_icf_apc)'[^`]+)`\);/g)]
      .map((m) => m[1]);
    expect(schema, "all six generated ICF tables are present").to.have.length(6);
    await database.connect();
    await database.execute(schema);
  });

  const clear = async () => {
    for (const t of ["icfservice", "icfhandler", "icfdocu", "zosd_icf_origin", "zosd_icf_aside", "zosd_icf_apc"]) {
      await client().execute(`DELETE FROM "${t}";`);
    }
  };
  beforeEach(clear);
  after(() => database.disconnect());

  it("a first apply puts every node of the tree in the table", async () => {
    const said = [];
    const {actions} = await applyTo(client(), objects(), {say: (l) => said.push(l)});
    expect(actions.every((a) => a.action === "INSERT"), "nothing to compare with yet").to.equal(true);
    const rows = await currentRows(client());
    expect(rows.ICFSERVICE.length).to.equal(objects().ICFSERVICE.length);
    expect(rows.ICFHANDLER.length).to.equal(objects().ICFHANDLER.length);
    // and a quiet start is quiet because nothing was set aside
    expect(said).to.deep.equal([]);
  });

  it("applying again changes nothing, which is what makes writable mean anything", async () => {
    await applyTo(client(), objects());
    const {actions} = await applyTo(client(), objects());
    expect(actions.every((a) => a.action === "KEEP"), actions.map((a) => a.action).join(",")).to.equal(true);
  });

  it("refreshes the APC implementation when only SAPC changes and removes stale applications", async () => {
    const original = objects();
    await applyTo(client(), original);
    const changed = {...original, ZOSD_ICF_APC: original.ZOSD_ICF_APC.map((a) => ({...a, HANDLER: "ZCL_CHANGED_APC"}))};
    const result = await applyTo(client(), changed);
    expect(result.actions.every((a) => a.action === "KEEP")).to.equal(true);
    const saved = (await client().select({select: "SELECT handler FROM zosd_icf_apc"})).rows;
    expect(saved.length).to.equal(changed.ZOSD_ICF_APC.length);
    expect(saved.every((r) => String(r.handler ?? r.HANDLER).trim() === "ZCL_CHANGED_APC")).to.equal(true);
    await applyTo(client(), {...original, ZOSD_ICF_APC: []});
    expect((await client().select({select: "SELECT * FROM zosd_icf_apc"})).rows).to.deep.equal([]);
  });

  it("applies a description-only change, removal, and addition to ICFDOCU", async () => {
    const initial = objects();
    const original = initial.ICFDOCU[0];
    expect(original, "the fixture has a described node").to.exist;
    const target = initial.ICFSERVICE.find((s) => keyOf(s) === keyOf(original));
    await applyTo(client(), initial);

    const changed = {...initial, ICFDOCU: initial.ICFDOCU.map((d) =>
      d === original ? {...d, ICF_DOCU: "A new description"} : d)};
    const change = await applyTo(client(), changed);
    expect(change.actions.find((a) => a.key === keyOf(target)).action).to.equal("REPLACE");
    expect((await currentRows(client())).ICFDOCU.find((d) => keyOf(d) === keyOf(target)).ICF_DOCU)
      .to.equal("A new description");

    const removed = {...initial, ICFDOCU: initial.ICFDOCU.filter((d) => keyOf(d) !== keyOf(target))};
    const removal = await applyTo(client(), removed);
    expect(removal.actions.find((a) => a.key === keyOf(target)).action).to.equal("REPLACE");
    expect((await currentRows(client())).ICFDOCU.filter((d) => keyOf(d) === keyOf(target))).to.deep.equal([]);

    const addition = await applyTo(client(), initial);
    expect(addition.actions.find((a) => a.key === keyOf(target)).action).to.equal("REPLACE");
    expect((await currentRows(client())).ICFDOCU.find((d) => keyOf(d) === keyOf(target)).ICF_DOCU)
      .to.equal(original.ICF_DOCU);
  });

  it("upgrades a legacy hash while retaining EDITED activity and local description, then stays quiet", async () => {
    const original = objects();
    const docu = original.ICFDOCU[0];
    expect(docu, "the fixture has a described node").to.exist;
    const target = original.ICFSERVICE.find((s) => keyOf(s) === keyOf(docu));
    const handlers = original.ICFHANDLER.filter((h) => keyOf(h) === keyOf(target));
    const legacyHash = contentHash(target, handlers);
    const newHash = contentHash(target, handlers,
      original.ICFDOCU.filter((d) => keyOf(d) === keyOf(target)));
    expect(newHash).to.not.equal(legacyHash);
    await applyTo(client(), original);
    await client().execute(`UPDATE "icfservice" SET "icfactive" = '' WHERE "icf_name" = '${target.ICF_NAME}' AND "icfparguid" = '${target.ICFPARGUID}';`);
    await client().execute(`UPDATE "icfdocu" SET "icf_docu" = 'Edited locally' WHERE "icf_name" = '${target.ICF_NAME}' AND "icfparguid" = '${target.ICFPARGUID}';`);
    await markEdited(client(), target.ICF_NAME, target.ICFPARGUID);
    await client().execute(`UPDATE "zosd_icf_origin" SET "objhash" = '${legacyHash}' WHERE "icf_name" = '${target.ICF_NAME}' AND "icfparguid" = '${target.ICFPARGUID}';`);

    const upgraded = await applyTo(client(), original);
    const action = upgraded.actions.find((a) => a.key === keyOf(target));
    expect(action.action).to.equal("KEEP");
    expect(action.upgradeHash).to.equal(true);
    expect((await currentOrigins(client())).get(keyOf(target))).to.include({origin: EDITED, hash: newHash});
    expect((await currentRows(client())).ICFSERVICE.find((s) => keyOf(s) === keyOf(target)).ICFACTIVE)
      .to.equal("");
    expect((await currentRows(client())).ICFDOCU.find((d) => keyOf(d) === keyOf(target)).ICF_DOCU)
      .to.equal("Edited locally");
    expect((await client().select({select: `SELECT * FROM zosd_icf_aside`})).rows).to.have.length(0);

    const again = await applyTo(client(), original);
    expect(again.actions.find((a) => a.key === keyOf(target))).to.include({action: "KEEP", hash: newHash});
    expect(again.actions.find((a) => a.key === keyOf(target)).upgradeHash).to.equal(undefined);
    expect(again.report).to.deep.equal([]);
    expect((await currentOrigins(client())).get(keyOf(target)).origin).to.equal(EDITED);
    expect((await currentRows(client())).ICFSERVICE.find((s) => keyOf(s) === keyOf(target)).ICFACTIVE)
      .to.equal("");
    expect((await currentRows(client())).ICFDOCU.find((d) => keyOf(d) === keyOf(target)).ICF_DOCU)
      .to.equal("Edited locally");
  });

  it("deletes descriptions removed from a legacy SEEDED object and then stays quiet", async () => {
    const initial = objects();
    const docu = initial.ICFDOCU[0];
    const target = initial.ICFSERVICE.find((s) => keyOf(s) === keyOf(docu));
    const hash = contentHash(target, initial.ICFHANDLER.filter((h) => keyOf(h) === keyOf(target)));
    await applyTo(client(), initial);
    await client().execute(`UPDATE "zosd_icf_origin" SET "objhash" = '${hash}' WHERE "icf_name" = '${target.ICF_NAME}' AND "icfparguid" = '${target.ICFPARGUID}';`);
    const removed = {...initial, ICFDOCU: initial.ICFDOCU.filter((d) => keyOf(d) !== keyOf(target))};
    const result = await applyTo(client(), removed);
    expect(result.actions.find((a) => a.key === keyOf(target)).action).to.equal("REPLACE");
    expect((await currentRows(client())).ICFDOCU.filter((d) => keyOf(d) === keyOf(target))).to.deep.equal([]);
    const again = await applyTo(client(), removed);
    expect(again.actions.find((a) => a.key === keyOf(target)).action).to.equal("KEEP");
  });

  it("an edit survives a second apply of the same objects", async () => {
    // the case the whole rule exists for: a start that re-applied every
    // object would undo every edit and the ABAP screen would be a picture
    await applyTo(client(), objects());
    const node = (await currentRows(client())).ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    // `icfaltnme` rather than a description: the description moved into
    // ICFDOCU, where a real system keeps it, and ICFSERVICE never had it
    await client().execute(`UPDATE "icfservice" SET "icfaltnme" = 'SETBYAPERSON' WHERE "icf_name" = '${node.ICF_NAME}';`);
    await markEdited(client(), node.ICF_NAME, node.ICFPARGUID);

    await applyTo(client(), objects());
    const after = (await currentRows(client())).ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    expect(after.ICFALTNME, "the edit stands").to.equal("SETBYAPERSON");
  });

  it("an object that changed replaces an edited row, and the old one is kept", async () => {
    await applyTo(client(), objects());
    const before = objects();
    const target = before.ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    await markEdited(client(), target.ICF_NAME, target.ICFPARGUID);

    // the object now says something else
    const changed = {
      ICFSERVICE: before.ICFSERVICE.map((s) => (s.URL === target.URL ? {...s, ICFALTNME: "WHATTHEOBJECT"} : s)),
      ICFHANDLER: before.ICFHANDLER,
    };
    const said = [];
    const {actions} = await applyTo(client(), changed, {say: (l) => said.push(l)});
    expect(actions.filter((a) => a.action === "ASIDE").map((a) => a.url)).to.deep.equal(["/sap/bc/osd/rfc/"]);

    const after = (await currentRows(client())).ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    expect(after.ICFALTNME, "the object wins").to.equal("WHATTHEOBJECT");
    const aside = (await client().select({select: `SELECT * FROM zosd_icf_aside`})).rows;
    expect(aside.length, "and the previous row is somewhere that survives the restart").to.equal(1);
    // **and it keeps the handler it replaced.** The first version read the
    // handler off the ICFSERVICE row, which has no such field, so every
    // record said "" -- and the handler rows are deleted in the same
    // breath. The one thing the content hash calls part of a node was the
    // one thing "kept aside" lost, and this test counted rows rather than
    // reading one, so it passed throughout. Found by an adversarial review.
    expect(String(aside[0].HANDLER ?? aside[0].handler ?? "").trim(),
      "the aside record keeps what answered before").to.equal("ZCL_OSD_RFC_HTTP");
    expect(said.join(" "), "said out loud").to.contain("kept aside");
    // an applied row is the object's again, so the next start is quiet
    expect((await currentOrigins(client())).get(keyOf(target)).origin).to.not.equal(EDITED);
  });

  it("an empty object list is refused, because it is a wrong root and not an empty tree", async () => {
    // A compiled binary takes its root from OSD_ROOT or the working
    // directory. Started outside the tree it finds no `*.sicf.xml`, every
    // applied row becomes a REMOVE, and the registry is wiped and reported
    // as "N of N nodes applied from their objects". Found by an adversarial
    // review as the worst of the binary's failure modes.
    const {applyAtStartup} = await import("../tools/osd-icf-apply.mjs");
    await applyTo(client(), objects());
    const before = (await currentRows(client())).ICFSERVICE.length;
    const said = [];
    const out = await applyAtStartup(client(), {root: "/tmp", say: (l) => said.push(l)});
    expect(out, "it refuses rather than applying").to.equal(undefined);
    expect(said.join(" ")).to.contain("refusing to apply an empty registry");
    expect((await currentRows(client())).ICFSERVICE.length, "and the rows are still there").to.equal(before);
  });

  it("a node whose object is gone is removed if nobody touched it, kept if somebody did", async () => {
    await applyTo(client(), objects());
    const all = objects();
    const gone = all.ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    const kept = all.ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/se16/");
    await markEdited(client(), kept.ICF_NAME, kept.ICFPARGUID);

    const fewer = {
      ICFSERVICE: all.ICFSERVICE.filter((s) => s.URL !== gone.URL && s.URL !== kept.URL),
      ICFHANDLER: all.ICFHANDLER.filter((h) => keyOf(h) !== keyOf(gone) && keyOf(h) !== keyOf(kept)),
    };
    const said = [];
    const {actions} = await applyTo(client(), fewer, {say: (l) => said.push(l)});
    expect(actions.filter((a) => a.action === "REMOVE").map((a) => a.url)).to.include(gone.URL);
    expect(actions.filter((a) => a.action === "ORPHAN").map((a) => a.url)).to.deep.equal([kept.URL]);

    const urls = (await currentRows(client())).ICFSERVICE.map((s) => s.URL);
    expect(urls, "the untouched one is gone").to.not.include(gone.URL);
    expect(urls, "the edited one is kept").to.include(kept.URL);
    expect(said.join(" ")).to.contain("no object explains it");
    // and the removal is said out loud too: it is the only action that
    // takes a path away, so it is the one most worth not discovering by 404
    expect(said.join(" ")).to.contain("removed");
  });
});
