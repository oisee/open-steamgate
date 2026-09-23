// A dictionary read off folders of abapGit XML, for the corpus instruments.
//
// The runtime resolves a data element through the ObjectStore of the tree it
// runs in. The corpus instruments run over somebody else's packages, unzipped
// into a scratch folder, and over the released DOMA/DTEL dump when it is
// cloned -- neither is a tree with an abap_transpile.json. What both have is
// files named `<object>.<type>.xml`, which is all `resolveType` reads, so
// this is the smallest object it accepts: `read(type, name)` answering the
// file's text, indexed once per folder and never parsed here.
import {readdirSync, readFileSync, statSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {resolveType} from "../osd-type-graph.mjs";

/** the released S/4 DOMA/DTEL dump, when `.local/lars` holds it -- looked for
 *  upward from the working directory, because a worktree under
 *  `.local/worktrees/` shares the primary checkout's `.local/lars` */
export const RELEASED_DDIC = (() => {
  const tail = ".local/lars/s4-private-2022-doma-and-dtel/src";
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, tail);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return tail;
})();

export class FolderDdic {
  constructor(folders = []) {
    this.index = new Map();
    /** the folders given, in order; the later one wins a name they share */
    this.folders = [];
    /** every name a later folder took over from an earlier one: {key, was, now} */
    this.overrides = [];
    /** how many data elements each folder resolved (once per resolution, credited to the DTEL's folder) */
    this.hits = new Map();
    for (const folder of folders) this.add(folder);
  }

  /** index every `*.dtel.xml` / `*.doma.xml` / `*.ttyp.xml` / `*.tabl.xml` / `*.ddls.asddls` under a folder. The rule is the one
   *  `abap_transpile.json`'s input_folder list has: **the later folder wins**
   *  a name both hold, and the override is recorded rather than silent. */
  add(folder) {
    if (!existsSync(folder)) return this;
    this.folders.push(folder);
    this.hits.set(folder, 0);
    const walk = (dir) => {
      // sorted: a dictionary must not depend on readdir order (Bun's differs
      // from Node's, CLAUDE.md), and a duplicate inside one folder is recorded
      // like an override rather than resolved by whichever came last
      for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        // DTEL and DOMA as abapGit XML; a DDLS as its source, because a
        // table function's signature is in the source and nowhere else
        const m = /^(.+)\.(dtel|doma|ttyp|tabl)\.xml$/i.exec(entry.name) ?? /^(.+)\.(ddls)\.asddls$/i.exec(entry.name);
        if (m === null) continue;
        const key = `${m[2].toUpperCase()}:${m[1].toUpperCase().replaceAll("#", "/")}`;
        const was = this.index.get(key);
        if (was !== undefined) this.overrides.push({key, was: was.folder, now: folder, ...(was.folder === folder ? {duplicate: true} : {})});
        this.index.set(key, {path, folder});
      }
    };
    walk(folder);
    return this;
  }

  get size() {
    return this.index.size;
  }

  /** what `ddicCatalogue` asks before it resolves: is there an object of that type and name */
  find(type, name) {
    const found = this.index.get(`${String(type).toUpperCase()}:${String(name).toUpperCase()}`);
    return found === undefined ? undefined : {name: String(name).toUpperCase(), path: found.path};
  }

  /** every object of one type, by name */
  list(type) {
    const prefix = `${String(type).toUpperCase()}:`;
    return [...this.index.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({name: key.slice(prefix.length)}));
  }

  /** what `osd-type-graph.resolveType` asks of a store */
  read(type, name) {
    const found = this.index.get(`${String(type).toUpperCase()}:${String(name).toUpperCase()}`);
    if (found === undefined) return undefined;
    return {source: readFileSync(found.path, "utf8")};
  }

  /** the `resolve(name)` the scalar typer takes: {DATATYPE, LENG, DECIMALS} or undefined */
  resolver() {
    return (name) => {
      const found = resolveType(this, name);
      if (found.KIND !== "DTEL" || found.DATATYPE === "") return undefined;
      const owner = this.index.get(`DTEL:${String(name).toUpperCase()}`)?.folder;
      if (owner !== undefined) this.hits.set(owner, (this.hits.get(owner) ?? 0) + 1);
      return found;
    };
  }

  /** one line per folder, for a report header: what was given and what it answered */
  describe() {
    const taken = this.overrides.filter((one) => one.duplicate !== true).length;
    const duplicates = this.overrides.length - taken;
    return this.folders.map((folder) => `${folder}  (${this.hits.get(folder) ?? 0} resolved)`)
      .concat(taken === 0 ? [] : [`${taken} names taken over by a later folder`])
      .concat(duplicates === 0 ? [] : [`${duplicates} names twice inside one folder (the later path won)`]);
  }
}

/** folders that are there, in the order given; a missing one is skipped rather than failing the run */
export function existingFolders(candidates) {
  return candidates.filter((one) => existsSync(one) && statSync(one).isDirectory());
}
