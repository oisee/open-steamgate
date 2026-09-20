// The drift rule, as something that decides rather than something written.
import {expect} from "chai";
import {EDITED, SEEDED, contentHash, keyOf, plan, report} from "../tools/osd-icf-apply.mjs";

// `docs/registry-drift.md` ends with four cases and the sentence "each of
// these is a test before it is a paragraph". This is that. The rule is
// checked as a decision over three inputs -- what the objects say, what the
// table holds, where each row came from -- and not by writing rows, because
// a rule entangled with the writing of rows can only be checked by writing
// rows.
describe("docs/registry-drift: what happens when the table and the objects disagree", () => {
  const node = (name, url, handler) => ({
    ICF_NAME: name, ICFPARGUID: "P", ICFNODGUID: "G", ICFALTNME: "",
    ICFACTIVE: "X", ORIG_NAME: name.toLowerCase(), URL: url, ICF_DOCU: "",
    ...(handler === undefined ? {} : {}),
  });
  const chain = (name, handler) => (handler === undefined ? []
    : [{ICF_NAME: name, ICFPARGUID: "P", ICFORDER: "01", ICFTYP: "A", ICFHANDLER: handler}]);
  const rows = (name, url, handler) => ({ICFSERVICE: [node(name, url)], ICFHANDLER: chain(name, handler)});
  const key = keyOf({ICF_NAME: "ZA", ICFPARGUID: "P"});
  const hashOf = (r) => contentHash(r.ICFSERVICE[0], r.ICFHANDLER);

  const only = (actions, what) => {
    expect(actions.map((a) => a.action)).to.deep.equal([what]);
    return actions[0];
  };

  it("a node the table does not have is inserted: that is how a node arrives", () => {
    const objects = rows("ZA", "/sap/bc/a/", "ZCL_A");
    only(plan(objects, {ICFSERVICE: [], ICFHANDLER: []}), "INSERT");
  });

  it("an object that has not changed since it was applied changes nothing", () => {
    // **The case that makes "writable" mean anything.** A start that
    // re-applied every object would undo every edit and the ABAP screen
    // would be a picture of a registry rather than one.
    const objects = rows("ZA", "/sap/bc/a/", "ZCL_A");
    const table = rows("ZA", "/sap/bc/a/", "ZCL_SOMETHING_ELSE_SOMEBODY_SET");
    const origins = new Map([[key, {origin: EDITED, hash: hashOf(objects)}]]);
    const kept = only(plan(objects, table, origins), "KEEP");
    expect(kept.why).to.contain("has not changed");
  });

  it("a row still the object's own is replaced quietly, because nothing was lost", () => {
    const objects = rows("ZA", "/sap/bc/a/", "ZCL_NEW");
    const table = rows("ZA", "/sap/bc/a/", "ZCL_OLD");
    const origins = new Map([[key, {origin: SEEDED, hash: hashOf(table)}]]);
    only(plan(objects, table, origins), "REPLACE");
  });

  it("a row somebody edited is replaced AND the previous row is kept and reported", () => {
    // the shape the schema-drift rule already has: move aside, say so,
    // never silently
    const objects = rows("ZA", "/sap/bc/a/", "ZCL_NEW");
    const table = rows("ZA", "/sap/bc/a/", "ZCL_TYPED_BY_A_PERSON");
    const origins = new Map([[key, {origin: EDITED, hash: hashOf(table)}]]);
    const aside = only(plan(objects, table, origins), "ASIDE");
    expect(aside.previous.URL).to.equal("/sap/bc/a/");
    expect(aside.service.URL).to.equal("/sap/bc/a/");
    expect(aside.why, "it must say why").to.have.length.greaterThan(20);
    expect(report([aside]).join(" "), "and a start says it out loud").to.contain("kept aside");
  });

  it("an edited row no object explains is kept, and reported", () => {
    const table = rows("ZA", "/sap/bc/a/", "ZCL_A");
    const origins = new Map([[key, {origin: EDITED, hash: "whatever"}]]);
    const orphan = only(plan({ICFSERVICE: [], ICFHANDLER: []}, table, origins), "ORPHAN");
    expect(report([orphan]).join(" ")).to.contain("no object explains it");
  });

  it("a row that was only ever the object's is removed when the object goes", () => {
    const table = rows("ZA", "/sap/bc/a/", "ZCL_A");
    const origins = new Map([[key, {origin: SEEDED, hash: hashOf(table)}]]);
    only(plan({ICFSERVICE: [], ICFHANDLER: []}, table, origins), "REMOVE");
    // and with nothing known about where it came from, it is not an orphan:
    // an unrecorded row is the seeder's, because nothing else has ever
    // written one
    only(plan({ICFSERVICE: [], ICFHANDLER: []}, table), "REMOVE");
  });

  it("the handler chain is part of what changed, not only the node", () => {
    // a node whose class changed and whose URL did not has changed, and a
    // hash over the service row alone would call that "unchanged" and never
    // apply it
    const before = rows("ZA", "/sap/bc/a/", "ZCL_A");
    const after = rows("ZA", "/sap/bc/a/", "ZCL_B");
    expect(hashOf(before)).to.not.equal(hashOf(after));
    const origins = new Map([[key, {origin: SEEDED, hash: hashOf(before)}]]);
    only(plan(after, before, origins), "REPLACE");
  });

  it("description changes, additions, and removals change the object hash", () => {
    const base = rows("ZA", "/sap/bc/a/", "ZCL_A");
    const english = {ICF_NAME: "ZA", ICFPARGUID: "P", ICF_LANGU: "E", ICF_DOCU: "English"};
    const german = {...english, ICF_LANGU: "D", ICF_DOCU: "Deutsch"};
    const withDocu = (docu) => ({...base, ICFDOCU: docu});
    const actionsFor = (before, after) => plan(after, before,
      new Map([[key, {origin: SEEDED,
        hash: contentHash(base.ICFSERVICE[0], base.ICFHANDLER, before.ICFDOCU)}]]));

    expect(contentHash(base.ICFSERVICE[0], base.ICFHANDLER, [english, german]))
      .to.equal(contentHash(base.ICFSERVICE[0], base.ICFHANDLER, [german, english]));
    expect(contentHash(base.ICFSERVICE[0], base.ICFHANDLER))
      .to.equal(contentHash(base.ICFSERVICE[0], base.ICFHANDLER, []));
    only(actionsFor(withDocu([english]), withDocu([{...english, ICF_DOCU: "Revised"}])), "REPLACE");
    only(actionsFor(withDocu([]), withDocu([english])), "REPLACE");
    only(actionsFor(withDocu([english]), withDocu([])), "REPLACE");
  });

  it("upgrades a legacy hash without losing an edited row or its local description", () => {
    const objects = {...rows("ZA", "/sap/bc/a/", "ZCL_A"), ICFDOCU: [
      {ICF_NAME: "ZA", ICFPARGUID: "P", ICF_LANGU: "E", ICF_DOCU: "English"},
    ]};
    const table = {...objects, ICFSERVICE: [{...objects.ICFSERVICE[0], ICFACTIVE: ""}]};
    const legacyHash = contentHash(objects.ICFSERVICE[0], objects.ICFHANDLER);
    const kept = only(plan(objects, table,
      new Map([[key, {origin: EDITED, hash: legacyHash}]])), "KEEP");
    expect(kept.upgradeHash).to.equal(true);
    expect(kept.hash).to.not.equal(legacyHash);
    expect(kept.hash).to.equal(contentHash(objects.ICFSERVICE[0], objects.ICFHANDLER, objects.ICFDOCU));
    const disagreeing = {...table, ICFDOCU: [{...objects.ICFDOCU[0], ICF_DOCU: "Edited locally"}]};
    // The old hash did not record descriptions, so this first upgrade cannot
    // tell a local edit from an incoming description change. Preserve EDITED.
    const local = only(plan(objects, disagreeing,
      new Map([[key, {origin: EDITED, hash: legacyHash}]])), "KEEP");
    expect(local.upgradeHash).to.equal(true);
    expect(local.hash).to.equal(kept.hash);
    only(plan(objects, disagreeing,
      new Map([[key, {origin: SEEDED, hash: legacyHash}]])), "REPLACE");
  });

  it("removes a SEEDED legacy description even when the incoming empty digest matches", () => {
    const incoming = {...rows("ZA", "/sap/bc/a/", "ZCL_A"), ICFDOCU: []};
    const previous = {...incoming, ICFDOCU: [
      {ICF_NAME: "ZA", ICFPARGUID: "P", ICF_LANGU: "E", ICF_DOCU: "Before"},
    ]};
    const hash = contentHash(incoming.ICFSERVICE[0], incoming.ICFHANDLER);
    only(plan(incoming, previous, new Map([[key, {origin: SEEDED, hash}]])), "REPLACE");
    only(plan(incoming, previous, new Map([[key, {origin: EDITED, hash}]])), "KEEP");
    only(plan(incoming, incoming, new Map([[key, {origin: SEEDED, hash}]])), "KEEP");
  });

  it("the report is empty when nothing was set aside, and that is not silence", () => {
    // a quiet start is quiet because nothing happened, not because the
    // reporting is optional
    expect(report([{action: "INSERT", url: "/x/"}, {action: "REPLACE", url: "/y/"}])).to.deep.equal([]);
  });
});
