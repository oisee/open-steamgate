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
 * when the working tree differs from the last commit.
 */
export function objectVersions(root, file, user) {
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
  active.stamp = stampOf(active.date);
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

/**
 * The feed. `base` is the URI the feed answers at (…/source/main/versions);
 * each entry's content is <base>/<stamp>/<version>/content, the shape A4H
 * writes, which a client takes verbatim from atom:content@src.
 */
export function versionsFeedDocument(name, base, {versions}) {
  const entries = versions.map((v) => `  <atom:entry>
    <atom:author>
      <atom:name>${escape(v.author)}</atom:name>
    </atom:author>
    <atom:content type="text/plain" src="${escape(`${base}/${v.stamp}/${v.version}/content`)}"/>
    <atom:id>${v.version}</atom:id>
    <atom:title>${escape(v.title)}</atom:title>
    <atom:updated>${v.date.toISOString()}</atom:updated>
  </atom:entry>`).join("\n");
  const updated = versions[0]?.date ?? new Date(0);
  return `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">
  <atom:title>Version List of ${escape(name)}</atom:title>
  <atom:updated>${updated.toISOString()}</atom:updated>
${entries}
</atom:feed>
`;
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
  const history = gitObjectHistory(root, file, ALL);
  const commits = history.available === true ? history.entries : [];
  const index = commits.length - Number(version);
  if (index < 0 || index >= commits.length) {
    throw new Error(`${file} has no version ${version}`);
  }
  return gitObjectRevisionAt(root, file, commits[index].revision).source;
}
