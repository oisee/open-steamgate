// The fetch, from the outside: what JavaScript calls when a repository has
// to come in.
//
// Everything here is a thin call into ZCL_OSD_GIT, which speaks the git
// smart HTTP protocol, and into abapGit's pack and delta code, which this
// repository transpiles as a library. So the answer to "where does the
// clone happen" is: inside OSD, in ABAP, with no git binary anywhere in
// the path. The reason it is worth saying is that a system has no git
// binary either, and a doppelganger that needed one would be lying about
// what it is.
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {ObjectStore} from "./osd-store.mjs";

export class Git {
  constructor(store = new ObjectStore()) {
    this.store = store;
  }

  // the runtime that holds the transpiled ABAP; the same one the gateway
  // serves from, because a clone reads no rows and writes none
  async #abap() {
    // the runtime is one per process: if something already brought it up,
    // booting a second time would re-seed the database under whoever is
    // using it
    if (globalThis.abap?.Classes?.["ZCL_OSD_GIT"] === undefined) {
      await this.store.data().boot();
    }
    const abap = globalThis.abap;
    const git = abap?.Classes?.["ZCL_OSD_GIT"];
    if (git === undefined) {
      throw new NotBuilt();
    }
    return {abap, git};
  }

  // every branch and tag of a remote, with the commit each points at
  async refs(url) {
    const {abap, git} = await this.#abap();
    const answer = await readable(() => git.refs({iv_url: text(abap, url)}));
    return answer.array().map((row) => ({
      sha1: row.get().sha1.get(),
      name: row.get().name.get(),
    }));
  }

  // one branch as files: path, name and the bytes, which is what the
  // importer wants and what abapGit's deserialise would have been handed
  async clone(url, options = {}) {
    const {abap, git} = await this.#abap();
    const started = Date.now();
    const answer = await readable(() => git.clone({
      iv_url: text(abap, url),
      iv_branch: text(abap, options.branch ?? ""),
    }));
    const value = answer.get();
    return {
      url: value.url.get(),
      branch: value.branch.get(),
      commit: value.commit.get(),
      ms: Date.now() - started,
      files: value.files.array().map((row) => ({
        path: row.get().path.get(),
        filename: row.get().filename.get(),
        data: Buffer.from(row.get().data.get(), "hex"),
      })),
    };
  }

  // a clone on disk, so the importer can read it the way it reads any
  // checked-out repository
  write(clone, folder) {
    for (const file of clone.files) {
      const at = join(folder, file.path.replace(/^\//, ""), file.filename);
      mkdirSync(dirname(at), {recursive: true});
      writeFileSync(at, file.data);
    }
    return {folder, files: clone.files.length};
  }
}

function text(abap, value) {
  return new abap.types.String().set(String(value));
}

// an ABAP exception carries its text in message variables, which a
// JavaScript caller cannot read off the object. get_text is what composes
// them, so a failure arrives as an Error someone can print.
async function readable(call) {
  try {
    return await call();
  } catch (error) {
    if (typeof error?.get_text !== "function") {
      throw error;
    }
    const text = await error.get_text();
    throw new GitFailed(String(text?.get?.() ?? text).trimEnd(), error);
  }
}

export class GitFailed extends Error {
  constructor(message, cause) {
    super(message);
    this.code = "GIT_FAILED";
    this.cause = cause;
  }
}

export class NotBuilt extends Error {
  constructor() {
    super("ZCL_OSD_GIT is not in the runtime: transpile first");
    this.code = "NOT_BUILT";
  }
}

async function main(args) {
  const url = args.find((a) => a.startsWith("-") === false);
  if (url === undefined) {
    console.log("usage: osd-git.mjs <url> [--refs] [--branch main] [--into <folder>]");
    return 2;
  }
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const git = new Git();

  if (args.includes("--refs")) {
    for (const ref of await git.refs(url)) {
      console.log(`${ref.sha1} ${ref.name}`);
    }
    return 0;
  }

  const clone = await git.clone(url, {branch: at("--branch")});
  console.log(`${clone.files.length} files from ${clone.url} at ${clone.commit.slice(0, 8)} (${clone.branch}), ${clone.ms} ms`);
  const into = at("--into");
  if (into !== undefined) {
    if (existsSync(into) === false) {
      mkdirSync(into, {recursive: true});
    }
    console.log(`written to ${git.write(clone, into).folder}`);
  } else {
    for (const file of clone.files.slice(0, 20)) {
      console.log(`  ${file.path}${file.filename} ${file.data.length} bytes`);
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  });
}
