// The versions of one object's source, as ADT serves them: an Atom feed at
// .../source/main/versions (a class include: .../includes/<include>/versions)
// and each version's source at .../versions/<timestamp>/<version>/content.
// This is what Eclipse's Revision History, "Compare With" and vsp read.
//
// Nothing here is stored. The versions are the file's commits
// (tools/osd-git-history.mjs), the way ZOSD_STORE HISTORY answers ABAP, and
// the numbering is the one measured on A4H (foreman-dell, 2026-09-30): a
// local object has one version, 00000, which is the active source, dated at
// its last activation. Here 00000 is the working tree, and the commits
// that changed the file are 00001..n, oldest first, so a number stays with
// its commit as history grows. An object git has no history for has 00000
// only, which is what a local object on a system has too.
import {statSync} from "node:fs";
import {join} from "node:path";
import {gitObjectHistory, gitObjectRevisionAt, gitObjectState} from "./osd-git-history.mjs";
import {sapUserOf} from "./osd-store-destination.mjs";

const ALL = 100000;

const escape = (text) => String(text ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 20260930181500: the segment a version's URI carries before its number
const stampOf = (date) => date.toISOString().slice(0, 19).replace(/[-T:]/g, "");

/**
 * The versions of a file, newest first: 00000 (the working tree) and one
 * per commit that changed it. `user` names the active version's author
 * when the working tree differs from the last commit. `file` undefined is
 * a class include that has no file: 00000 only.
 */
export function objectVersions(root, file, user) {
  if (file === undefined) {
    // a class include with no file yet: it has no past, and its main
    // include's commits are not its versions
    return {versions: [{version: "00000", stamp: ACTIVE_STAMP, date: new Date(0), author: user, title: ""}],
      note: "the include has no file"};
  }
  const history = gitObjectHistory(root, file, ALL);
  const commits = history.available === true ? history.entries : [];
  let modified = true;
  try {
    modified = commits.length === 0 || gitObjectState(root, file).status !== "clean";
  } catch {
    // a tree git cannot read: the working tree is all there is
  }
  let changed = new Date(0);
  try {
    changed = statSync(join(root, file)).mtime;
  } catch {
    // an include with no file of its own yet
  }
  const newest = commits[0];
  const active = {
    version: "00000",
    date: modified || newest === undefined ? changed : new Date(newest.authoredAt),
    author: modified || newest === undefined ? user : sapUserOf(newest.author),
    title: "",
  };
  active.stamp = ACTIVE_STAMP;
  const versions = [active, ...commits.map((entry, index) => {
    const date = new Date(entry.authoredAt);
    return {
      version: String(commits.length - index).padStart(5, "0"),
      stamp: stampOf(date),
      date,
      author: sapUserOf(entry.author),
      title: String(entry.subject ?? ""),
      revision: entry.revision,
      short: entry.short,
    };
  })];
  return {versions, note: history.available === true ? "" : history.reason};
}

// what A4H writes for the active version: the segment and the feed's own
// atom:updated are this constant, whatever the object (foreman-dell's raw
// capture, 2026-09-30), while the entry's atom:updated is its real date
const ACTIVE_STAMP = "19700101101123";
const ACTIVE_UPDATED = "1970-01-01T10:11:23Z";

// the type in the feed title: REPS for a program's source, CLAS for a class
// include (measured); the rest are the object's own type (not measured)
const TITLE_TYPE = {PROG: "REPS", INCL: "REPS", CLAS: "CLAS"};

/**
 * The feed. `base` is the absolute path the feed answers at
 * (…/source/main/versions); each entry's content is
 * <base>/<stamp>/<version>/content, which a client takes verbatim from
 * atom:content@src. The root and the 00000 entry are A4H's byte for byte
 * (one line, adtcore declared and unused, entry children author, content,
 * id, updated, no title, no link). A4H has no transported version to
 * measure, so a commit's entry is this design: the same shape plus its
 * subject as atom:title, and its own date in the segment.
 */
export function versionsFeedDocument(name, type, base, {versions}) {
  const entries = versions.map((v) => "<atom:entry>" +
    `<atom:author><atom:name>${escape(v.author)}</atom:name></atom:author>` +
    `<atom:content type="text/plain" src="${escape(`${base}/${v.stamp}/${v.version}/content`)}"/>` +
    `<atom:id>${v.version}</atom:id>` +
    (v.version === "00000" ? "" : `<atom:title>${escape(v.title)}</atom:title>`) +
    `<atom:updated>${v.date.toISOString().replace(/\.\d{3}Z$/, "Z")}</atom:updated>` +
    "</atom:entry>").join("");
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">' +
    `<atom:title>Version List of ${escape(name)} (${TITLE_TYPE[type] ?? escape(type)})</atom:title>` +
    `<atom:updated>${ACTIVE_UPDATED}</atom:updated>` +
    entries + "</atom:feed>";
}

/**
 * One version's source. 00000 is `active`, the working tree's source; any
 * other number is read out of its commit at the path the file had then.
 * A number the feed does not list is an error, never the active source.
 */
export function versionSource(root, file, version, active) {
  if (!/^\d{5}$/.test(String(version))) {
    throw new Error(`${version} is not a version number`);
  }
  if (version === "00000") return active;
  if (file === undefined) throw new Error("the include has no file, so no version but 00000");
  const history = gitObjectHistory(root, file, ALL);
  const commits = history.available === true ? history.entries : [];
  const index = commits.length - Number(version);
  if (index < 0 || index >= commits.length) {
    throw new Error(`${file} has no version ${version}`);
  }
  return gitObjectRevisionAt(root, file, commits[index].revision).source;
}
