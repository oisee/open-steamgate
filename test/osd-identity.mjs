import {expect} from "chai";
import {readFileSync} from "node:fs";
import {bootIdentity, identity, sessionCookieName, systemId} from "../tools/osd-identity.mjs";

// the one list of cases, read by go/sysid's test as well
const {cases} = JSON.parse(readFileSync(new URL("../tools/gogen/go/sysid/testdata/cases.json", import.meta.url), "utf8"));

// One system id, one setting (tools/osd-identity.mjs): OSD_SID, its alias
// STG_ADT_SID, the default OSD. Every surface takes it from identity(), so
// these cases are the rule; test/webgui.mjs asks the running surfaces.
describe("osd identity: one system id", () => {
  it("is OSD when nothing is set, and says it was the default", () => {
    expect(systemId({})).to.deep.equal({sid: "OSD", source: "default"});
    const who = identity({});
    expect(who.sid).to.equal("OSD");
    expect(who.sidSource).to.equal("default");
  });

  it("is the same id for the runtime and for ADT", () => {
    for (const env of [{}, {OSD_SID: "qrs"}, {STG_ADT_SID: "osx"}, {OSD_SID: "abc", STG_ADT_SID: "xyz"}]) {
      const who = identity(env);
      expect(who.adt.systemID, JSON.stringify(env)).to.equal(who.sid);
    }
  });

  it("applies the shared cases: SAP's format, refused rather than truncated", () => {
    expect(cases.length).to.be.greaterThan(10);
    for (const c of cases) {
      if (c.error) {
        expect(() => systemId(c.env), c.name).to.throw(new RegExp(`^${c.error}=.*is not a system id`));
        expect(() => identity(c.env), c.name).to.throw(/is not a system id/);
      } else {
        expect(systemId(c.env), c.name).to.deep.equal({sid: c.sid, source: c.source});
      }
    }
  });

  it("never truncates: ABCDE and ABCXY are not both ABC", () => {
    expect(() => systemId({OSD_SID: "ABCDE"})).to.throw(/OSD_SID="ABCDE"/);
    expect(() => systemId({OSD_SID: "ABCXY"})).to.throw(/OSD_SID="ABCXY"/);
  });

  it("names the session cookie after the id and the ADT client", () => {
    expect(sessionCookieName({})).to.equal("SAP_SESSIONID_OSD_001");
    expect(sessionCookieName({OSD_SID: "qrs"})).to.equal("SAP_SESSIONID_QRS_001");
    expect(sessionCookieName({STG_ADT_SID: "osx", OSD_ADT_CLIENT: "002"})).to.equal("SAP_SESSIONID_OSX_002");
    // nothing that would break the header gets into the name: it refuses
    expect(() => sessionCookieName({OSD_SID: "a;b"})).to.throw(/is not a system id/);
  });

  it("refuses the boot with an invalid setting rather than starting under another id", () => {
    expect(() => bootIdentity(undefined, {OSD_SID: "ABCD"})).to.throw(/OSD_SID="ABCD" is not a system id/);
  });

  it("keeps the client split: sy-mandt 123, ADT 001", () => {
    const who = identity({});
    expect(who.client).to.equal("123");
    expect(who.adt.client).to.equal("001");
  });
});
