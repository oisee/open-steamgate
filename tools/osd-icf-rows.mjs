#!/usr/bin/env node
// The ICF nodes of this tree, as the rows a system keeps them in.
//
//   node tools/osd-icf-rows.mjs           the rows, as a table
//   node tools/osd-icf-rows.mjs --json    the same, for a caller
//
// **This is the seeder half of G.5, and the rule it obeys is written down
// first** (`docs/registry-drift.md`): on a real system the objects ARE the
// table -- `ICFSERVICE` and `ICFHANDLER` are the registry, SICF is a screen
// over them, and abapGit writes those rows when it imports a `*.sicf.xml`.
// So a file is a **transport** and the rows are the thing, which is why
// there is no `ZOSD_ICF` here: the tables are SAP's, reimplemented in
// `src/osd/ddic/` the way `CROSS` and `WBCROSSGT` already are, and ABAP that
// reads SICF the way a system does works unchanged.
//
// What this file deliberately does NOT do is write `data/*.tabu.json`. That
// would make the registry **seed data**, and seed data is re-seeded whenever
// the generation changes -- correct for a flight-booking fixture, fatal for
// configuration, because every node somebody made from a screen would vanish
// at the next build and the screen would be a toy. The rows get in through
// an apply step that knows who last wrote each one; this computes what the
// objects say, and nothing more.
import {createHash} from "node:crypto";
import {channels, services} from "./osd-icf.mjs";
import {handlerRows} from "./osd-icf.mjs";
import {readFileSync} from "node:fs";
import {runsAs} from "./osd-main.mjs";

/** abapGit's own node identity: the first 25 hex of sha1 over the node's
 *  URL. Not invented here -- `icfNodeFile` in tools/osd-bsp-app.mjs already
 *  uses it, measured against 35 real SICF files in the corpus, of which 33
 *  match exactly. The parent's guid is the same function of the parent's
 *  URL, which is how a tree becomes rows without anybody storing a tree. */
export const guidOf = (url) => createHash("sha1").update(url).digest("hex").slice(0, 25).toUpperCase();

/** The URL of the node above this one. `/sap/bc/osd/rfc/` -> `/sap/bc/osd/`,
 *  and the root's parent is itself empty rather than missing: a row needs a
 *  key, and `NOTNULL` on ICFPARGUID is the system's own answer to that. */
export function parentUrl(url) {
  const trimmed = url.replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at <= 0 ? "" : `${trimmed.slice(0, at)}/`;
}

/** One node, as the two rows it is: the service and its handler chain. */
export function rowsOf(node) {
  const url = `${node.path}/`;
  const name = (node.name ?? node.path.split("/").pop()).toUpperCase();
  const parent = parentUrl(url);
  const service = {
    ICF_NAME: name,
    ICFPARGUID: parent === "" ? "" : guidOf(parent),
    ICFNODGUID: guidOf(url),
    ICFALTNME: "",
    // A node this tree carries is active: abapGit inserts one already
    // active (docs/a4h-deploy.md), and a node that answers nothing would
    // not be in the tree at all.
    ICFACTIVE: "X",
    ORIG_NAME: name.toLowerCase(),
    // **`URL` is ours, and a real `ICFSERVICE` has no such column.** On a
    // system a node's path IS the parent chain -- abapGit reconstructs it
    // with `cl_icf_tree=>service_from_url` and `HTTP_GET_URL_FROM_NODGUID`
    // precisely because it is not stored. We denormalise it because this
    // runtime has no ICF tree to walk, and saying so here is the honest
    // version of a claim that was wrong until an adversarial review caught
    // it: these tables are ICF-SHAPED, not ICF's. Deriving the path from
    // ICFPARGUID is the truer thing and it is a later step, not a comment.
    URL: url,
  };
  const handlers = (node.handlers ?? []).map((h, i) => ({
    ICF_NAME: name,
    ICFPARGUID: service.ICFPARGUID,
    ICFORDER: h.order ?? String(i + 1).padStart(2, "0"),
    ICFTYP: h.icftyp ?? "A",
    ICFHANDLER: h.handler,
  }));
  return {service, handlers};
}

export function icfRows(root = ".", options = {}) {
  const icfservice = [];
  const icfhandler = [];
  // the description is a row of its own, keyed by language, which is where
  // a real system keeps it: every *.sicf.xml in the corpus carries it in an
  // <ICFDOCU> block rather than inside <ICFSERVICE>
  const icfdocu = [];
  const apc = [];
  for (const node of services(root, options)) {
    // the whole chain, not the last of it: a row per handler is what the
    // table holds, and `serviceOf` reduces the chain to the one that answers
    const chain = handlerRows(readFileSync(node.source, "utf8"))
      .map((r) => ({handler: r.handler, icftyp: r.icftyp, order: r.order}));
    const {service, handlers} = rowsOf({...node, handlers: chain});
    icfservice.push(service);
    icfhandler.push(...handlers);
    if (node.description !== undefined && node.description !== "") {
      icfdocu.push({
        ICF_NAME: service.ICF_NAME, ICFPARGUID: service.ICFPARGUID,
        ICF_LANGU: "E", ICF_DOCU: node.description.slice(0, 100),
      });
    }
  }
  // an APC application's SICF node carries no handler at all, and it is
  // still a node: it exists, and the inventory that cannot see it is the
  // one that reports a path nobody serves
  for (const channel of channels(root, options)) {
    const {service} = rowsOf({...channel, handlers: []});
    let node = icfservice.find((s) => s.URL === service.URL);
    if (node === undefined) {
      icfservice.push(service);
      node = service;
    }
    // SAPC owns the WebSocket implementation, not the HTTP handler chain.
    // Link by URL to the existing SICF node, whose name need not be the
    // SAPC application ID. Keep this read-only inventory in our own table.
    apc.push({ICF_NAME: node.ICF_NAME, ICFPARGUID: node.ICFPARGUID,
      APPLICATION_ID: channel.name, CLASS_NAME: channel.handler, STATEFUL: channel.stateful ? "X" : ""});
    if (channel.description && !icfdocu.some((d) => d.ICF_NAME === node.ICF_NAME && d.ICFPARGUID === node.ICFPARGUID)) {
      icfdocu.push({ICF_NAME: node.ICF_NAME, ICFPARGUID: node.ICFPARGUID,
        ICF_LANGU: "E", ICF_DOCU: channel.description.slice(0, 100)});
    }
  }
  const by = (a, b) => (a.URL ?? a.ICF_NAME) < (b.URL ?? b.ICF_NAME) ? -1 : 1;
  return {ICFSERVICE: icfservice.sort(by), ICFHANDLER: icfhandler.sort(by), ICFDOCU: icfdocu.sort(by), ZOSD_ICF_APC: apc.sort(by)};
}

if (runsAs("osd-icf-rows.mjs")) {
  const rows = icfRows(process.argv.slice(2).find((a) => a.startsWith("--") === false) ?? ".");
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, undefined, 2));
  } else {
    for (const s of rows.ICFSERVICE) {
      const chain = rows.ICFHANDLER.filter((h) => h.ICF_NAME === s.ICF_NAME && h.ICFPARGUID === s.ICFPARGUID);
      console.log(`${s.ICF_NAME.padEnd(16)} ${s.URL.padEnd(40)} ${chain.map((h) => `${h.ICFTYP}:${h.ICFHANDLER}`).join(", ") || "(no handler)"}`);
    }
    console.log(`\n${rows.ICFSERVICE.length} rows in ICFSERVICE, ${rows.ICFHANDLER.length} in ICFHANDLER.`);
    console.log("The objects are the transport; the rows are the registry -- docs/registry-drift.md.");
  }
}
