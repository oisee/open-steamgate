// The ICF registry as rows, which is what a system keeps it as.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {guidOf, icfRows, parentUrl, rowsOf} from "../tools/osd-icf-rows.mjs";
import {services} from "../tools/osd-icf.mjs";

describe("tools/osd-icf-rows: the objects are the transport, the rows are the registry", () => {
  const rows = icfRows(".");

  it("every node of the tree is a row, and every handler of it a row of its own", () => {
    const nodes = services(".");
    for (const node of nodes) {
      const row = rows.ICFSERVICE.find((s) => s.URL === `${node.path}/`);
      expect(row, `${node.path} is a row`).to.not.equal(undefined);
      expect(row.ICF_NAME).to.equal((node.name ?? "").toUpperCase());
    }
    // the chain, not the last of it: `serviceOf` reduces a node to the
    // handler that answers, and the table holds every row of the chain
    const status = rows.ICFHANDLER.filter((h) => h.ICF_NAME === "ZOSD_STATUS");
    expect(status.map((h) => h.ICFHANDLER)).to.deep.equal(["ZCL_OSD_STATUS_HTTP"]);
    expect(status[0].ICFTYP, "the type is read, not assumed").to.equal("A");
    expect(status[0].ICFORDER).to.equal("01");
  });

  it("the key is the node AND its parent, because a name repeats under two of them", () => {
    // ZO4D_DEMO is a node under /sap/bc/ and another under /sap/bc/apc/sap/.
    // Keying on the name alone would make one of them disappear, which is
    // why a system keys ICFSERVICE on (ICF_NAME, ICFPARGUID).
    const twice = rows.ICFSERVICE.filter((s) => s.ICF_NAME === "ZO4D_DEMO");
    expect(twice.length, "one name, two nodes").to.equal(2);
    expect(twice[0].ICFPARGUID).to.not.equal(twice[1].ICFPARGUID);
    const keys = new Set(rows.ICFSERVICE.map((s) => `${s.ICF_NAME}|${s.ICFPARGUID}`));
    expect(keys.size, "and the key is unique over the whole table").to.equal(rows.ICFSERVICE.length);
  });

  it("a node's identity is abapGit's, not one we made up", () => {
    // `icfNodeFile` in tools/osd-bsp-app.mjs names a SICF file with the
    // first 25 hex of sha1 over the URL, measured against 35 real files in
    // the corpus. The row's guid is the same function of the same input, so
    // a node written by a system and a node written here are the same node.
    const node = rows.ICFSERVICE.find((s) => s.URL === "/sap/bc/osd/rfc/");
    expect(node.ICFNODGUID).to.equal(guidOf("/sap/bc/osd/rfc/"));
    expect(node.ICFPARGUID).to.equal(guidOf("/sap/bc/osd/"));
    expect(node.ICFNODGUID).to.match(/^[0-9A-F]{25}$/);
  });

  it("the parent of a node is the path above it, and the root's is empty", () => {
    expect(parentUrl("/sap/bc/osd/rfc/")).to.equal("/sap/bc/osd/");
    expect(parentUrl("/sap/bc/")).to.equal("/sap/");
    expect(parentUrl("/sap/")).to.equal("");
    expect(parentUrl("/")).to.equal("");
  });

  it("a node with no handler is still a node", () => {
    // an APC application's SICF entry carries no handler -- the class lives
    // in the *.sapc.xml beside it -- and a registry that dropped it would
    // report a path nobody serves
    const apc = rows.ICFSERVICE.find((s) => s.URL === "/sap/bc/apc/sap/zstg_apc_demo/");
    expect(apc, "the push channel's node is in the table").to.not.equal(undefined);
    expect(rows.ICFHANDLER.filter((h) => h.ICF_NAME === apc.ICF_NAME && h.ICFPARGUID === apc.ICFPARGUID))
      .to.deep.equal([]);
  });

  it("a row is no wider than the column it lives in", () => {
    // the same class of defect as WWWPARAMS-OBJID being CHAR 40: a value
    // written wider than its column is a value the database silently
    // reshapes. Read off the DDIC rather than remembered.
    const widths = (file) => {
      const xml = readFileSync(file, "utf8");
      const out = new Map();
      for (const m of xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
        const name = /<FIELDNAME>([^<]+)</.exec(m[1])?.[1];
        const leng = /<LENG>0*(\d+)</.exec(m[1])?.[1];
        if (name !== undefined && leng !== undefined) out.set(name, Number(leng));
      }
      return out;
    };
    for (const [file, table] of [["src/osd/ddic/icfservice.tabl.xml", "ICFSERVICE"],
      ["src/osd/ddic/icfhandler.tabl.xml", "ICFHANDLER"]]) {
      const width = widths(file);
      expect(width.size, `${table} has fields`).to.be.greaterThan(3);
      for (const row of rows[table]) {
        for (const [field, value] of Object.entries(row)) {
          expect(width.get(field), `${table}-${field} is a field of the table`).to.not.equal(undefined);
          expect(String(value).length, `${table}-${field} = "${value}"`).to.be.at.most(width.get(field));
        }
      }
    }
  });
});
