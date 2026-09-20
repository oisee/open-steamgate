#!/usr/bin/env node
// BSP applications in the tree -> a registry the ABAP handler reads.
//
// A `*.wapa.xml` and its pages under an input folder are a BSP application,
// in the shape abapGit writes and a system reads (`docs/a4h-deploy.md`).
// Until now this repository could **make** one and could not **serve** one:
// `webapp/` and every pack were static files behind `express`, which is the
// only place in this tree where the request path is not ABAP, and the reason
// the same artefact did not run in both runtimes.
//
// This is the generator half. It reads the objects and writes
// `gen/bsp/zcl_stg_bsp_registry.clas.abap`, one row per page, the way
// `segw-registry.mjs` writes the service registry. `zcl_osd_bsp` serves them
// on `/sap/bc/ui5_ui5/sap/<app>/<page>`, which is the path a real system
// answers on.
//
// **The bytes do not travel in the class.** They used to: 33 pages became
// 141 KB of chunked base64 inside `zcl_stg_bsp_registry`, which is assets in
// source, a transpile on every image and linear growth per application.
// Alice, on seeing it: "чёто диковатый способ".
//
// The correction that matters is hers as well -- **imitate the interface,
// not the storage.** The first answer to this was a DDIC table, because a
// system keeps pages in `O2PAGELINE`; that is the wrong layer. The pages are
// files in a directory and they stay files in a directory.
//
// So each page becomes a **Web Repository object**, which is the mechanism
// this tree already carries 33 media objects and 16 MB on: a `*.w3mi.xml`
// beside a data file, `WWWDATA_IMPORT` + `SCMS_BINARY_TO_XSTRING` to read
// it, and a host hook (`abap.W3MI_LOADER`) where there is no file system.
// Nothing new is invented, nothing is encoded twice, and the browser preview
// and the compiled binary already know how to answer for it.
//
// Two things to keep straight about that choice:
//
//   - `gen/` is not tracked, so the data files beside the generated objects
//     are a build artefact and not a second copy of `webapp/` that can
//     drift. The source of truth is still the folder the app lives in.
//   - This is how **our** runtime carries the bytes. On a real system the
//     application travels as a BSP application (WAPA, `docs/a4h-deploy.md`)
//     and `/UI5/CL_UI5_HTTP_HANDLER` serves it out of `O2PAGELINE`. W3MI is
//     the local carrier, not a claim about SAP.
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {checkAppName, manifestFor} from "./osd-bsp-app.mjs";
import {runsAs} from "./osd-main.mjs";

// what a browser is told a page is. A BSP page carries no MIME in the
// object, so it is derived from the name -- the same rule the UI5 repository
// applies when it puts a file in.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

export const mimeOf = (name) => MIME[name.slice(name.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";

function walk(dir, hit = []) {
  if (existsSync(dir) === false) return hit;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, hit);
    else hit.push(full);
  }
  return hit;
}

/** Every BSP application under the given folders, with its pages read.
 *
 *  The page list comes from the `.wapa.xml` and not from the directory: the
 *  descriptor is the object, and a file beside it that the descriptor does
 *  not name is not a page of the application. A page the descriptor names
 *  and whose file is missing is an error and says so -- the pair is the
 *  thing, and half of it is not a smaller thing. */
// **An application of ours is declared, not hand-serialized.**
//
// A `*.wapa.xml` beside its pages is how an application ARRIVES -- imported
// from a system, or built for one. It is a poor way to keep one we edit:
// the pages are flat files named `<app>.wapa.i18n_-i18n.properties`, and a
// second copy of a folder we already have is two copies that drift.
//
// So our own apps stay readable folders and declare themselves in
// `src/bsp/apps.json`: `{"ZOSD_STATUS_APP": {"folder": "webapp/status",
// "text": "..."}}`. The object is generated from the folder, the same way
// gen/stg is generated from a YAML, and there is one source for each app.
export function declared(file = "src/bsp/apps.json") {
  if (existsSync(file) === false) {
    return [];
  }
  const decl = JSON.parse(readFileSync(file, "utf8"));
  return Object.entries(decl).map(([app, d]) => {
    // **The name limit is checked here too, and that gap was real.** A BSP
    // application name is at most 15 characters because it becomes an
    // ICFNAME (measured on A4H in cl_o2_helper=>check_application_name_valid).
    // osd-bsp-app.mjs refused a longer one at DEPLOY time and this file did
    // not, so an app could be declared, generated and served here and then
    // be refused by the system with "WAPA - error from create_new: 4". The
    // first three declarations included a 16-character name.
    checkAppName(app);
    const at = d.folder;
    // **An application is a list of files, and a folder is the common case
    // rather than the definition.** webapp/'s top level holds two of them --
    // the travel app (index.html, Component.js, manifest.json, i18n/) and
    // the launchpad shell (flp.html, launchpad.js, and its images) -- and on
    // a system they are two BSP applications. Moving the files apart would
    // be truer, and it would touch about forty references in a dozen files,
    // including two e2e suites, the Easy Access screen's ABAP and the
    // preview. So `files` says which of a folder's files an application is,
    // and the move stays a separate decision rather than a 5am one.
    const pages = (d.files ?? walk(at).map((f) => f.slice(at.length + 1).replaceAll("\\", "/")))
      .flatMap((f) => (existsSync(join(at, f)) && statSync(join(at, f)).isDirectory()
        ? walk(join(at, f)).map((g) => g.slice(at.length + 1).replaceAll("\\", "/"))
        : [f]))
      .sort();
    return {
      app,
      text: d.text ?? app,
      file,
      // **The data source is made absolute, and the folder keeps its
      // relative one.** A manifest under /app/status/ reaches its service
      // with `../../sap/opu/odata/...`; under
      // /sap/bc/ui5_ui5/sap/<app>/ that same string lands in
      // /sap/bc/ui5_ui5/sap/opu/odata/ and the app reads nothing. It cannot
      // simply be made absolute at the source either: in the GitHub Pages
      // preview the origin's root is not this system's root, which is why it
      // was relative in the first place.
      //
      // So the generated object differs from the folder in exactly one line,
      // and that is derivation rather than drift -- but it is said out loud
      // here, because "byte for byte with its source" is a claim this breaks.
      pages: pages.map((page) => ({
        page,
        mime: mimeOf(page),
        content: page.endsWith("manifest.json") && d.service !== undefined
          ? Buffer.from(manifestFor(readFileSync(join(at, page), "utf8"), d.service))
          : readFileSync(join(at, page)),
      })),
      missing: [
        ...(existsSync(at) ? [] : [`the folder ${at} is not there`]),
        ...pages.filter((f) => existsSync(join(at, f)) === false).map((f) => `${at}/${f}`),
      ],
    };
  });
}

/** A pack's page is a BSP application too, without the pack saying so.
 *
 *  A pack already declares a name and carries a `webapp/`; requiring it to
 *  repeat itself in `apps.json` would be a second registry for the same
 *  fact -- which is the thing this whole track is removing. The application
 *  name is derived, and because a derivation can collide where a written
 *  name cannot, a collision is **refused and names both packs** rather than
 *  letting one pack quietly serve the other's pages. */
export function packAppName(pack) {
  return ("Z" + pack.toUpperCase().replace(/[^A-Z0-9]/g, "_")).slice(0, 15).replace(/_+$/, "");
}

export function packApps(root = ".") {
  const packs = [];
  for (const dir of ["packs", ...(process.env.OSD_PACKS ?? "").split(":").filter(Boolean)]) {
    const at = join(root, dir);
    if (existsSync(at) === false) continue;
    for (const name of readdirSync(at)) {
      const web = join(at, name, "webapp");
      if (existsSync(join(at, name, "osd-pack.json")) && existsSync(web)) {
        packs.push({pack: name, at: web});
      }
    }
  }
  const byName = new Map();
  const apps = [];
  for (const {pack, at} of packs) {
    const app = packAppName(pack);
    if (byName.has(app)) {
      throw new Error(`packs ${byName.get(app)} and ${pack} both derive the BSP application name ${app}: rename one, or give it an entry in src/bsp/apps.json`);
    }
    byName.set(app, pack);
    checkAppName(app);
    const pages = walk(at).map((f) => f.slice(at.length + 1).replaceAll("\\", "/")).sort();
    apps.push({
      app,
      text: `pack ${pack}`,
      file: join(at, "..", "osd-pack.json"),
      pages: pages.map((page) => ({page, mime: mimeOf(page), content: readFileSync(join(at, page))})),
      missing: [],
    });
  }
  return apps;
}

// **The name a system would know the object by**, which is what
// `wwwparams-objid` holds and what ABAP selects on. The file name is free --
// abaplint reads the name out of the XML (`w3miObjectName`) and never from
// the spelling on disk -- so this can stay readable instead of escaped.
//
// **40, and it was measured rather than assumed.** The first version of this
// said 60 from memory; `WWWPARAMS-OBJID` in the DDIC is `LENG 000040`, and
// three of the 33 pages are longer than that -- the longest,
// `ZOSD_BOOKING_AP/ANNOTATIONS/ANNOTATIONS.XML`, by three characters. A key
// this tree writes longer than the column it lives in is the same defect as
// a versioned file name written narrower than its fixed width
// (docs/a4h-deploy.md), found the same way: by reading the field.
export const W3MI_NAME_WIDTH = 40;

export function w3miName(app, page) {
  // A UI5 application's file layout is not ours to shorten --
  // `annotations/annotations.xml` and `controller/App.controller.js` are the
  // framework's spelling -- so a name that does not fit is cut to the column
  // rather than refused. That is only safe because it cannot collide in
  // silence: `generate()` compares every name it produced and throws naming
  // BOTH pages, which is the check the truncation is paid for with.
  return `${app}/${page}`.toUpperCase().slice(0, W3MI_NAME_WIDTH);
}

// The file the pair is written as.
//
// `/` is spelled `_-`, which is what the tree already does for a BSP page
// (tools/osd-bsp-app.mjs), and **`.` is spelled `%2e`, which is not
// cosmetic**: abaplint reads an object's type out of the file name, so
// `ztravels_a4h_-manifest.json.w3mi.xml` parses as type `json.w3mi` and
// comes back "Unknown object type, currently not supported". That is why
// abapGit percent-escapes a name in the first place, and 33 of these
// failed the lint before the escape was copied.
export function w3miFile(app, page) {
  return `${app}_-${page.replaceAll("/", "_-")}`
    .toLowerCase()
    .replaceAll(".", "%2e")
    .replace(/[^a-z0-9_%-]/g, "_");
}

const extensionOf = (page) => {
  const at = page.lastIndexOf(".");
  return at === -1 ? ".bin" : page.slice(at).toLowerCase();
};

// `filesize` is deliberately **not** a parameter here. The transpiler writes
// one of its own from the data file's actual length
// (`populate_tables.ts`), so putting it in <PARAMS> as well is the same key
// twice and the seed dies on `UNIQUE constraint failed: wwwparams.relid,
// wwwparams.objid, wwwparams.name`. Leaving it out is also the better
// answer: a size that comes from the bytes cannot disagree with them.
export function w3miXml(app, page, mime) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_W3MI" serializer_version="v2.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <NAME>${w3miName(app, page)}</NAME>
   <TEXT>${app} ${page}</TEXT>
   <PARAMS>
    <WWWPARAMS><NAME>fileextension</NAME><VALUE>${extensionOf(page)}</VALUE></WWWPARAMS>
    <WWWPARAMS><NAME>filename</NAME><VALUE>${page}</VALUE></WWWPARAMS>
    <WWWPARAMS><NAME>mimetype</NAME><VALUE>${mime}</VALUE></WWWPARAMS>
   </PARAMS>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

export function applications(folders) {
  const apps = [];
  for (const folder of folders) {
    for (const file of walk(folder).filter((f) => f.endsWith(".wapa.xml"))) {
      const xml = readFileSync(file, "utf8");
      const app = /<APPLNAME>([^<]*)/.exec(xml)?.[1] ?? "";
      const text = /<TEXT>([^<]*)/.exec(xml)?.[1] ?? app;
      const at = dirname(file);
      const prefix = `${app.toLowerCase()}.wapa.`;
      const pages = [];
      const missing = [];
      for (const m of xml.matchAll(/<PAGENAME>([^<]*)<\/PAGENAME>/g)) {
        const page = m[1];
        const onDisk = join(at, prefix + page.replace(/^\./, "").replaceAll("/", "_-").toLowerCase());
        if (existsSync(onDisk) === false) {
          missing.push(page);
          continue;
        }
        pages.push({page, mime: mimeOf(page), content: readFileSync(onDisk)});
      }
      apps.push({app, text, file, pages, missing});
    }
  }
  return apps.sort((a, b) => (a.app < b.app ? -1 : 1));
}

const chunk = (s, n) => s.match(new RegExp(`.{1,${n}}`, "g")) ?? [];

export function registryClass(apps) {
  const rows = apps.flatMap((a) => a.pages.map((p) => `    CLEAR ls_page.\n`
    + `    ls_page-app   = \`${a.app}\`.\n`
    + `    ls_page-name  = \`${p.page}\`.\n`
    + `    ls_page-mime  = \`${p.mime}\`.\n`
    + `    ls_page-objid = \`${w3miName(a.app, p.page)}\`.\n`
    + `    APPEND ls_page TO rt_pages.\n`)).join("\n");
  return `CLASS zcl_stg_bsp_registry DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/osd-bsp-registry.mjs from the BSP applications of this
* tree - do not edit
*
* **A list, and no bytes.** The pages used to be chunked base64 in this
* source: 33 of them, 141 KB, an asset in a class. Each one is a Web
* Repository object now (the *.w3mi.xml pairs beside this file), which is the
* mechanism this tree already carries its media on -- so changing an image is
* not a transpile, and a browser with no file system still gets an answer
* through abap.W3MI_LOADER.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_page,
             app   TYPE string,
             name  TYPE string,
             mime  TYPE string,
             objid TYPE string,
           END OF ty_page.
    TYPES tt_page TYPE STANDARD TABLE OF ty_page WITH DEFAULT KEY.
    CLASS-METHODS pages
      RETURNING
        VALUE(rt_pages) TYPE tt_page.
ENDCLASS.

CLASS zcl_stg_bsp_registry IMPLEMENTATION.

  METHOD pages.
    DATA ls_page TYPE ty_page.                              "#EC NEEDED

${rows}  ENDMETHOD.

ENDCLASS.
`;
}

export function generate(folders, out = "gen/bsp") {
  const apps = [...applications(folders), ...declared(), ...packApps()];
  mkdirSync(out, {recursive: true});
  writeFileSync(join(out, "zcl_stg_bsp_registry.clas.abap"), registryClass(apps));

  // one Web Repository object per page, and **what this run did not write is
  // removed**. A generator that only adds leaves the object of a page
  // somebody deleted behind, and a stale object in an input folder is not
  // inert: it is transpiled, it fills a wwwparams row, and the next reader
  // of the tree sees a page that no application has.
  const kept = new Set();
  const byFile = new Map();
  const byName = new Map();
  for (const a of apps) {
    for (const p of a.pages) {
      const base = w3miFile(a.app, p.page);
      const seen = byFile.get(base);
      if (seen !== undefined) {
        throw new Error(`the pages ${seen} and ${a.app}/${p.page} both spell the file ${base}`);
      }
      byFile.set(base, `${a.app}/${p.page}`);
      const objid = w3miName(a.app, p.page);
      const other = byName.get(objid);
      if (other !== undefined) {
        throw new Error(`the pages ${other} and ${a.app}/${p.page} both become the Web Repository `
          + `name ${objid} at ${W3MI_NAME_WIDTH} characters: rename one of them`);
      }
      byName.set(objid, `${a.app}/${p.page}`);
      const xml = `${base}.w3mi.xml`;
      const data = `${base}.w3mi.data${extensionOf(p.page)}`;
      kept.add(xml);
      kept.add(data);
      writeFileSync(join(out, xml), w3miXml(a.app, p.page, p.mime));
      writeFileSync(join(out, data), p.content);
    }
  }
  for (const name of readdirSync(out)) {
    if (/\.w3mi\.(xml|data\.)/.test(name) && kept.has(name) === false) {
      rmSync(join(out, name));
    }
  }
  return apps;
}

if (runsAs("osd-bsp-registry.mjs")) {
  const argv = process.argv.slice(2);
  const folders = argv.filter((a) => a.startsWith("--") === false);
  const apps = generate(folders.length > 0 ? folders : ["src", "gen"]);
  for (const a of apps) {
    const bytes = a.pages.reduce((n, p) => n + p.content.length, 0);
    console.log(`osd-bsp-registry: ${a.app}: ${a.pages.length} pages, ${bytes} bytes  (${basename(a.file)})`);
    for (const m of a.missing) {
      console.error(`  MISSING: the descriptor names ${m} and no file carries it`);
    }
  }
  if (apps.length === 0) {
    console.log("osd-bsp-registry: no *.wapa.xml found -- nothing to serve");
  }
}
