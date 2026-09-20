// The registry as rows in a real database, applied by the rule.
import {expect} from "chai";
import {EDITED, applyTo, currentOrigins, currentRows, keyOf, markEdited} from "../tools/osd-icf-apply.mjs";
import {icfRows} from "../tools/osd-icf-rows.mjs";

// The four falsifications `docs/registry-drift.md` ends with, run against
// the database rather than over a plan. The plan is checked separately in
// test/osd-icf-apply.mjs; this is the other half -- that carrying it out
// leaves the rows the plan said it would, which a pure function cannot tell
// you.
describe("the ICF registry, applied to a database", function () {
  this.timeout(60000);
  const client = () => globalThis.abap.context.databaseConnections.DEFAULT;
  const objects = () => icfRows(".");

  // the runtime, because the rows are the point: a registry checked against
  // a fake client is a plan checked twice
  before(async () => {
    if (globalThis.abap === undefined) {
      const {initializeABAP} = await import("../output/init.mjs");
      await initializeABAP();
    }
  });

  const clear = async () => {
    for (const t of ["icfservice", "icfhandler", "zosd_icf_origin", "zosd_icf_aside"]) {
      await client().execute(`DELETE FROM "${t}";`);
    }
  };
  beforeEach(clear);
  after(clear);

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
