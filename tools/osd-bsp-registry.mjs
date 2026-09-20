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
// **Content travels as base64 and not as a string literal.** Three reasons,
// in the order they were hit: a page contains quotes and newlines and
// escaping them into ABAP literals is a second encoder nobody asked for; a
// page may be binary (a PNG in a pack) and a text literal cannot hold one;
// and `zcl_abapgit_convert=>base64_to_xstring` already exists in this tree,
// so there is no third codec to write or to be wrong. The lines are chunked
// because a generated source line of six thousand characters is unreadable
// in every tool that would ever show it.
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
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
  const rows = apps.flatMap((a) => a.pages.map((p) => {
    const b64 = chunk(a.pages.length === 0 ? "" : p.content.toString("base64"), 200);
    const parts = b64.length === 0
      ? "    ls_page-b64 = ``.\n"
      : b64.map((c) => `    ls_page-b64 = ls_page-b64 && \`${c}\`.\n`).join("");
    return `    CLEAR ls_page.\n`
      + `    ls_page-app  = \`${a.app}\`.\n`
      + `    ls_page-name = \`${p.page}\`.\n`
      + `    ls_page-mime = \`${p.mime}\`.\n`
      + parts
      + `    APPEND ls_page TO rt_pages.\n`;
  })).join("\n");
  return `CLASS zcl_stg_bsp_registry DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/osd-bsp-registry.mjs from the *.wapa.xml objects - do not edit
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_page,
             app  TYPE string,
             name TYPE string,
             mime TYPE string,
             b64  TYPE string,
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
  const apps = [...applications(folders), ...declared()];
  mkdirSync(out, {recursive: true});
  writeFileSync(join(out, "zcl_stg_bsp_registry.clas.abap"), registryClass(apps));
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
