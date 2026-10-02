import {expect} from "chai";
import {identity, sessionCookieName, systemId} from "../tools/osd-identity.mjs";

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

  it("takes OSD_SID, upper case and three characters", () => {
    expect(systemId({OSD_SID: " qrstu "})).to.deep.equal({sid: "QRS", source: "OSD_SID"});
  });

  it("takes STG_ADT_SID as an alias with the same meaning", () => {
    expect(systemId({STG_ADT_SID: "osx"})).to.deep.equal({sid: "OSX", source: "STG_ADT_SID"});
    expect(identity({STG_ADT_SID: "osx"}).sid).to.equal("OSX");
  });

  it("prefers OSD_SID when both are set, and treats a blank one as unset", () => {
    expect(systemId({OSD_SID: "abc", STG_ADT_SID: "xyz"}).sid).to.equal("ABC");
    expect(systemId({OSD_SID: "  ", STG_ADT_SID: "xyz"})).to.deep.equal({sid: "XYZ", source: "STG_ADT_SID"});
    expect(systemId({OSD_SID: "", STG_ADT_SID: ""})).to.deep.equal({sid: "OSD", source: "default"});
  });

  it("names the session cookie after the id and the ADT client", () => {
    expect(sessionCookieName({})).to.equal("SAP_SESSIONID_OSD_001");
    expect(sessionCookieName({OSD_SID: "qrs"})).to.equal("SAP_SESSIONID_QRS_001");
    expect(sessionCookieName({STG_ADT_SID: "osx", OSD_ADT_CLIENT: "002"})).to.equal("SAP_SESSIONID_OSX_002");
  });

  it("keeps the client split: sy-mandt 123, ADT 001", () => {
    const who = identity({});
    expect(who.client).to.equal("123");
    expect(who.adt.client).to.equal("001");
  });
});
