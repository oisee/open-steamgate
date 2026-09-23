import {expect} from "chai";
import {searchHelps, parseSearchHelp, shlpRegistryClass} from "../tools/segw-shlp.mjs";

describe("tools/segw-shlp: search help objects -> value help providers", () => {
  it("reads the demo's search help", () => {
    const helps = searchHelps(["src"]);
    const sh = helps.find((h) => h.name === "ZSTG_STATUS_SH");
    expect(sh).to.include({selmethod: "ZSTG_STATUS", selmexit: "", simple: true, collective: false});
    expect(sh.parameters.map((p) => p.name)).to.deep.equal(["STATUS", "STATUS_TEXT"]);
    expect(sh.parameters[1]).to.include({input: true, output: true, listPosition: 2, selectPosition: 2});
    const abap = shlpRegistryClass(helps);
    expect(abap).to.contain("iv_shlp_name = 'ZSTG_STATUS_SH'");
    expect(abap).to.contain("iv_selmethod = 'ZSTG_STATUS'");
    expect(abap).to.contain("iv_name            = 'STATUS_TEXT'");
    expect(abap).to.contain("lo_shlp->register( ).");
  });

  it("registers exit search helps by their exit, skips collective ones, survives an empty repository", () => {
    const exit = parseSearchHelp(`<abapGit><asx:values><DD30V><SHLPNAME>ZSTG_SH_PROD_TYPE</SHLPNAME>
<ISSIMPLE>X</ISSIMPLE><SELMTYPE>F</SELMTYPE><SELMEXIT>ZSTG_SHEXIT_TYPECODE</SELMEXIT></DD30V>
<DD32P_TABLE><DD32P><FIELDNAME>TYPE_CODE</FIELDNAME><SHLPINPUT>X</SHLPINPUT><SHLPOUTPUT>X</SHLPOUTPUT><SHLPLISPOS>01</SHLPLISPOS></DD32P></DD32P_TABLE>
</asx:values></abapGit>`, "x.shlp.xml");
    expect(exit).to.include({selmexit: "ZSTG_SHEXIT_TYPECODE", selmethod: ""});
    const collective = parseSearchHelp(`<abapGit><asx:values><DD30V><SHLPNAME>ZCOLL</SHLPNAME></DD30V>
<DD31S_TABLE><DD31S><SUBSHLP>ZSTG_STATUS_SH</SUBSHLP></DD31S></DD31S_TABLE></asx:values></abapGit>`, "c.shlp.xml");
    expect(collective.collective).to.equal(true);
    const abap = shlpRegistryClass([exit, collective]);
    expect(abap).to.contain("iv_selmexit  = 'ZSTG_SHEXIT_TYPECODE'");
    expect(abap).to.contain("* ZCOLL: collective search help, not registered");
    expect(abap).not.to.contain("iv_shlp_name = 'ZCOLL'");
    expect(shlpRegistryClass([])).to.contain("    RETURN.");
  });
});
