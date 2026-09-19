// A folder of web files as a BSP application, in abapGit's shape.
//
//   node tools/osd-bsp-app.mjs <folder> --name ZOSD_008_DEMO_APP --out <dir>
//        [--text "…"] [--service ZOSD_006_DEMO_SRV] [--only a,b,c]
//
// Why. The last thing in the README's loop that had never travelled is the
// **page**: the service reaches a system, and the Fiori app that talks to it
// still only runs here. A UI5 app on a system is a BSP application (WAPA) --
// one object with one page per file -- and abapGit can carry one.
//
// The shape is measured, not guessed: `.local/corpus/ui5-code-search`
// carries a real `ZUI5_CODE_SEA` serialized by abapGit's LCL_OBJECT_WAPA,
// and this writes the same thing:
//
//   <app>.wapa.xml                      ATTRIBUTES + one PAGES/item per file
//   <app>.wapa.<page>                   the file, `/` written `_-`, lower case
//
// What is deliberately NOT imitated: `/UI5/UI5_REPOSITORY_LOAD` replaces
// some page names with a `UI5<sha1>` hash and adds a
// `UI5RepositoryPathMapping.xml` page to map them back. Ten of the corpus
// app's pages are hashed that way. That is the uploader's doing, not
// abapGit's and not the format's -- a plain page name is what the other
// nineteen have -- so the pages here are named after the files.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import {runsAs} from "./osd-main.mjs";

const BOM = "﻿";

/** abapGit writes a page's path with `/` as `_-`, lower case, after the
 *  `<app>.wapa.` prefix. `controller/App.controller..js` is filed as
 *  `zui5_code_sea.wapa.controller_-app.controller..js`. */
export const pageFile = (app, page) => `${app.toLowerCase()}.wapa.${page.replace(/^\./, "").replaceAll("/", "_-").toLowerCase()}`;

/** and the key is the page name in upper case, which is what the PAGEKEY
 *  column of O2PAGDIR holds */
export const pageKey = (page) => page.toUpperCase();

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function wapaXml(app, pages, text) {
  const items = [...pages].sort((a, b) => (pageKey(a) < pageKey(b) ? -1 : 1)).map((page) => `    <item>
     <ATTRIBUTES>
      <APPLNAME>${app}</APPLNAME>
      <PAGEKEY>${escape(pageKey(page))}</PAGEKEY>
      <PAGENAME>${escape(page)}</PAGENAME>
      <PAGETYPE>X</PAGETYPE>
      <LAYOUTLANGU>E</LAYOUTLANGU>
      <VERSION>A</VERSION>
      <LANGU>E</LANGU>
     </ATTRIBUTES>
    </item>
`).join("");
  return `${BOM}<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_WAPA" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <ATTRIBUTES>
    <APPLNAME>${app}</APPLNAME>
    <APPLCLAS>/UI5/CL_UI5_BSP_APPLICATION</APPLCLAS>
    <APPLEXT>${app}</APPLEXT>
    <SECURITY>X</SECURITY>
    <ORIGLANG>E</ORIGLANG>
    <MODIFLANG>T</MODIFLANG>
    <TEXT>${escape(text)}</TEXT>
   </ATTRIBUTES>
   <PAGES>
${items}   </PAGES>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

/** The one line that has to change. A manifest served from
 *  /sap/bc/ui5_ui5/sap/<app>/ cannot reach a service with `../`, so the
 *  data source is made absolute -- and it is done here rather than in the
 *  tree, so nothing committed points at one system's service. */
export function manifestFor(text, service) {
  const m = JSON.parse(text);
  for (const ds of Object.values(m["sap.app"]?.dataSources ?? {})) {
    if (ds.type === "OData") {
      ds.uri = `/sap/opu/odata/sap/${service}/`;
    }
  }
  return JSON.stringify(m, undefined, 2) + "\n";
}

// The door. A BSP application is objects; what makes it answer on a URL is
// an **ICF node**, and abapGit's WAPA handler does not create one -- it has
// nothing to do with the UI5 repository at all (`ui5_rep_dt`, `ui5_ui5`,
// `cl_ui5` appear zero times in its source). `/UI5/UI5_REPOSITORY_LOAD` does
// create it, because `/ui5/cl_ui5_rep_dt=>create_repository` does, under the
// fixed parent `C_UI5_ICF_NODE_GUID = '3I2I44WJCWUB7IJYCK1741MH3'`.
//
// So the node travels as an ordinary SICF object beside the WAPA, and one zip
// carries both. The shape is copied from a real one in the corpus --
// `/sap/bc/ui5_ui5/mindset/analyzer_detail/` in MindsetAppAnalyzerFree, whose
// ICF_DOCU says "Deployed with SAP Fiori tools", i.e. a node the Fiori tools
// made and abapGit serialized back:
//
//   <URL>, <ICFSERVICE> with ICF_NAME and ORIG_NAME, <ICFDOCU>. **No
//   handler.** ICF inherits a handler down the tree, and the branch carries
//   /UI5/CL_UI5_HTTP_HANDLER, so the application's own node is only a name.
//
// abapGit creates it active: zcl_abapgit_object_sicf=>insert_sicf finds the
// parent with `cl_icf_tree=>service_from_url( iv_url )` -- from the <URL> in
// this file, not from its name -- and calls insert_node with
// `icfactive = abap_true`.
export const icfUrlOf = (app, namespace = "sap") => `/sap/bc/ui5_ui5/${namespace}/${app.toLowerCase()}/`;

/** `<node name padded to 15><first 25 hex of sha1(URL)>.sicf.xml`. Measured
 *  on 35 real SICF files in the corpus: 33 match exactly and the two that do
 *  not differ only in the case of the node inside its URL. On import the
 *  suffix does not matter -- abapGit takes the parent from <URL> -- so it is
 *  here to make the file the same one a system would write back. */
export function icfNodeFile(app, namespace = "sap") {
  const url = icfUrlOf(app, namespace);
  return app.toLowerCase().padEnd(15, " ") + createHash("sha1").update(url).digest("hex").slice(0, 25) + ".sicf.xml";
}

export function icfNodeXml(app, text, namespace = "sap") {
  return `${BOM}<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SICF" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <URL>${icfUrlOf(app, namespace)}</URL>
   <ICFSERVICE>
    <ICF_NAME>${app.toUpperCase()}</ICF_NAME>
    <ORIG_NAME>${app.toLowerCase()}</ORIG_NAME>
   </ICFSERVICE>
   <ICFDOCU>
    <ICF_NAME>${app.toUpperCase()}</ICF_NAME>
    <ICF_LANGU>E</ICF_LANGU>
    <ICF_DOCU>${escape(text)}</ICF_DOCU>
   </ICFDOCU>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

function filesUnder(root, at = root) {
  const out = [];
  for (const name of readdirSync(at)) {
    const full = join(at, name);
    if (statSync(full).isDirectory()) {
      out.push(...filesUnder(root, full));
    } else {
      out.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

// A BSP application name is **at most 15 characters** after its namespace,
// and the check is not advisory: `cl_o2_helper=>check_application_name_valid`
// does `IF strlen( l_applname ) GT 15` and raises `invalid`, and
// `cl_o2_api_application=>create_new` calls it with `refuse_long_name`
// defaulting to `'X'`. abapGit turns the refusal into its own
// `undefined_name`, and what a person sees is
//
//   WAPA - error from create_new: 4
//
// which names neither the field nor the limit. Read off A4H's own source
// 2026-09-19, after ZOSD_008_DEMO_APP (17) was refused. The same method also
// requires APPLEXT to equal APPLNAME, so nothing here lets them differ.
export const MAX_APP_NAME = 15;

export function checkAppName(app) {
  const bare = app.replace(/^\/[^/]+\//, "");
  if (bare.length > MAX_APP_NAME) {
    throw new Error(`${app}: a BSP application name is at most ${MAX_APP_NAME} characters and this is ${bare.length}. `
      + "cl_o2_helper=>check_application_name_valid refuses a longer one, and abapGit reports it as "
      + '"WAPA - error from create_new: 4", which says neither.');
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(bare) === false) {
    throw new Error(`${app}: a BSP application name is upper case letters, digits and underscore (RS_CHARACTER_CHECK)`);
  }
  return app;
}

export function buildApp({from, app, out, text = app, service, only, icf, namespace = "sap"}) {
  checkAppName(app);
  mkdirSync(out, {recursive: true});
  const keep = only === undefined ? undefined : new Set(only);
  const pages = filesUnder(from).filter((p) => keep === undefined || keep.has(p)).sort();
  if (pages.length === 0) {
    throw new Error(`${from}: no files to carry`);
  }
  for (const page of pages) {
    const body = page.endsWith("manifest.json") && service !== undefined
      ? Buffer.from(manifestFor(readFileSync(join(from, page), "utf8"), service))
      : readFileSync(join(from, page));
    writeFileSync(join(out, pageFile(app, page)), body);
  }
  writeFileSync(join(out, `${app.toLowerCase()}.wapa.xml`), wapaXml(app, pages, text));
  if (icf !== false) {
    writeFileSync(join(out, icfNodeFile(app, namespace)), icfNodeXml(app, text, namespace));
  }
  return pages;
}

if (runsAs("osd-bsp-app.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const from = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  const app = flag("name");
  const out = flag("out");
  if (from === undefined || app === undefined || out === undefined || existsSync(from) === false) {
    console.error("usage: osd-bsp-app.mjs <folder> --name ZOSD_008_DEMO_APP --out <dir> [--text …] [--service …] [--only a,b]");
    process.exit(2);
  }
  const only = flag("only") === undefined ? undefined : flag("only").split(",");
  const pages = buildApp({from, app, out, text: flag("text", app), service: flag("service"), only, icf: argv.includes("--no-icf") === false});
  console.log(`${app}: ${pages.length} pages -> ${out}`);
  if (argv.includes("--no-icf") === false) {
    console.log(`  + ICF node ${icfUrlOf(app)} (${icfNodeFile(app)})`);
  }
  for (const p of pages) console.log(`  ${p}`);
}
