// The object store, as a destination an ABAP screen can call (backlog G.8).
//
// **Why a destination and not a new door.** The editor screen is ABAP, and
// the store is a Node object holding the tree, the abaplint registry and the
// build. Two mechanisms for reaching a host from ABAP already exist and are
// the same one: the AMDP tile reaches HANA through
// `CALL FUNCTION ... DESTINATION 'AMDP'`, and the ST05 screen reaches the
// trace ring through `DESTINATION 'SQLTRACE'`. This is the third user of
// that seam, not a third seam.
//
// **What it deliberately does not do: a second write path.** The question
// the backlog called the first item of G.8's estimate -- where does an edit
// land? -- was answered on 2026-09-15 by the ADT facade and nobody wrote it
// back: `ObjectStore.write()` lands the object in the file it came from, in
// its own layer, as the two files abapGit would write, and `inactive` marks
// it until a check clears it. So this destination *calls* that, and an edit
// from the screen and an edit from Eclipse are the same edit. A screen that
// wrote sources itself would be a second answer to a settled question, and
// the two would drift on their first disagreement.
//
// **What Activate costs, measured 2026-09-19** on a tree of 1518 objects:
// a full build is 12 s and an edited tree never hits the build cache, since
// the cache is keyed by content and an edit is new content by definition.
// So CHECK (a parse, ~4 s) and ACTIVATE are two commands and the screen
// gives them two buttons: one name over a cheap and an expensive operation
// is a button people stop pressing.
import {given, givenText, fill} from "./osd-destination.mjs";
import {snapshotOf, changedSince} from "./osd-generation-diff.mjs";
import {objectOf} from "./osd-inputs.mjs";
import {basename, join} from "node:path";

const COMMANDS = ["LIST", "READ", "WRITE", "CHECK", "ACTIVATE"];

export class StoreDestination {
  /**
   * @param {object} options
   * @param {object} [options.store] the ObjectStore, or nothing where there
   *   is no tree to hold one (the browser preview serves a built system, not
   *   a checkout). Absent is answered, not crashed.
   * @param {string} [options.reason] why there is no store, in the words the
   *   person reading the screen needs
   */
  constructor(options = {}) {
    // A function is opened on the first call and not before: the store
    // indexes the tree and parses it, and a host that installs this
    // destination has not necessarily got a screen that will ever use it.
    // A store that throws when it is opened -- no tree here, which is the
    // binary and the browser -- becomes the reason rather than a crash.
    this.opener = typeof options.store === "function" ? options.store : undefined;
    this.store = this.opener === undefined ? options.store : undefined;
    this.opened = this.opener === undefined;
    this.reason = options.reason ?? "this process serves a built system and has no source tree";
    this.limit = options.limit ?? 200;
  }

  async #open() {
    if (this.opened === true) {
      return this.store;
    }
    this.opened = true;
    try {
      // awaited, because opening the store means importing it: the module
      // carries abaplint and node:fs, and the host that installs this is
      // also bundled into a service worker where neither exists
      this.store = await this.opener();
    } catch (error) {
      this.store = undefined;
      this.reason = String(error?.message ?? error);
    }
    return this.store;
  }

  async call(name, signature) {
    const command = givenText(signature, "IV_COMMAND", "LIST").toUpperCase();
    const answer = await this.#answer(command, signature);
    fill(signature, {...EMPTY, ...answer});
    return undefined;
  }

  async #answer(command, signature) {
    if (await this.#open() === undefined) {
      // Named, and with the reason. "No store" answered as an empty list is
      // a screen that says the system is empty, which is a different and
      // false statement.
      return {EV_ERROR: `no object store here: ${this.reason}`};
    }
    if (COMMANDS.includes(command) === false) {
      return {EV_ERROR: `unknown store command ${command}`};
    }
    const type = givenText(signature, "IV_TYPE").toUpperCase();
    const name = givenText(signature, "IV_NAME").toUpperCase();
    const include = givenText(signature, "IV_INCLUDE", "main") || "main";
    const source = given(signature, "IV_SOURCE");
    const started = Date.now();
    try {
      switch (command) {
        case "LIST": return this.#list(signature);
        case "READ": return this.#read(type, name, include);
        case "WRITE": return this.#write(type, name, include, source, started);
        case "CHECK": return this.#check(type, name, include, source, started);
        case "ACTIVATE": return await this.#activate(type, name, started);
      }
    } catch (error) {
      // the store's own refusals -- NotFound, ReadOnly, NotSupported -- are
      // answers a person can act on, so they are carried through as they are
      // written rather than turned into "failed"
      return {EV_ERROR: String(error?.message ?? error), EV_MS: String(Date.now() - started)};
    }
  }

  #list(signature) {
    const type = givenText(signature, "IV_TYPE").toUpperCase();
    const filter = givenText(signature, "IV_FILTER").toUpperCase();
    const limit = Number(givenText(signature, "IV_LIMIT")) || this.limit;
    const all = this.store.list()
      .filter((entry) => type === "" || entry.type === type)
      .filter((entry) => filter === "" || entry.name.includes(filter))
      .sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name));
    return {
      // the count is of what matched, not of what is shown: a list cut at
      // its limit that reports the cut length tells a person the system is
      // smaller than it is
      EV_COUNT: String(all.length),
      // `list()` gives a slim entry -- type, name, library, writable -- and
      // the screen needs the file and the package, which only the indexed
      // entry has. Resolved for the rows that are shown and not for the
      // 1500 that are not: the first version mapped the slim entry straight
      // into the row and every FILE column was empty, which reads as "this
      // object has no file" rather than as "nobody asked for it"
      ET_OBJECT: all.slice(0, limit)
        .map((entry) => this.store.find(entry.type, entry.name) ?? entry)
        .map((entry) => this.#row(entry)),
    };
  }

  #row(entry) {
    const state = this.store.stateOf(entry);
    return {
      TYPE: entry.type,
      NAME: entry.name,
      PACKAGE: String(entry.package ?? ""),
      FILE: String(entry.file ?? ""),
      // `writable` is the layer's property: a library object is read-only
      // here however much a person would like to edit it, and the screen
      // has to know before it offers a text area
      WRITABLE: entry.writable === false ? "" : "X",
      VERSION: state.version,
      CHANGED_AT: String(state.changedAt ?? ""),
    };
  }

  #read(type, name, include) {
    const read = this.store.read(type, name, include);
    return {
      EV_SOURCE: read.source,
      EV_FILE: String(read.file ?? ""),
      EV_PACKAGE: String(read.package ?? ""),
      EV_WRITABLE: read.writable === false ? "" : "X",
      EV_VERSION: this.store.stateOf(read).version,
      ET_OBJECT: [this.#row(read)],
    };
  }

  #write(type, name, include, source, started) {
    if (source === undefined) {
      // not "an empty source": a screen that posts a form with no text area
      // in it would otherwise silently empty the object it was showing
      return {EV_ERROR: "WRITE without IV_SOURCE: nothing was written"};
    }
    const written = this.store.write(type, name, String(source), include);
    return {
      EV_FILE: String(written.file ?? ""),
      EV_PACKAGE: String(written.package ?? ""),
      EV_VERSION: written.version ?? "inactive",
      EV_WRITABLE: "X",
      EV_MS: String(Date.now() - started),
    };
  }

  #check(type, name, include, source, started) {
    const options = source === undefined ? {} : {source: String(source), include};
    const result = this.store.check(type, name, options);
    return {
      EV_ACTIVE: result.issues.length === 0 ? "X" : "",
      EV_COUNT: String(result.issues.length),
      EV_MS: String(Date.now() - started),
      ET_ISSUE: result.issues.map((issue) => issueRow(issue, result)),
    };
  }

  async #activate(type, name, started) {
    const result = this.store.activate(type, name);
    // An activation refused by a *dependent* is the case activation exists
    // for, and the screen has to be able to say which caller broke -- so the
    // dependent's own name travels on its rows and is not flattened into the
    // object being activated.
    const issues = [
      ...result.issues.map((issue) => issueRow(issue, result)),
      ...(result.dependents ?? []).flatMap((dependent) =>
        dependent.issues.map((issue) => issueRow(issue, dependent))),
    ];
    if (result.active !== true) {
      return {
        EV_ACTIVE: "",
        EV_COUNT: String(issues.length),
        EV_MS: String(Date.now() - started),
        ET_ISSUE: issues,
      };
    }

    // **An activation that does not reach the running system is not one.**
    //
    // `activate()` is the verdict -- the object and everyone who uses it
    // still compile -- and stops there. The modules the runtime loads are
    // written by the transpile behind it, which is what `publish()` is, and
    // without that the screen would say "activated" over a system that goes
    // on answering with the old code. That sentence is worse than a slow
    // button.
    //
    // Whether the running process is REPLACED is a different question and
    // the answer depends on who is serving: under a supervisor
    // (`STG_SERVE=child`) the store holds the runtime and recycles it; in a
    // process that serves ABAP itself -- which is the process this
    // destination is usually installed in -- there is nothing to recycle
    // from the inside, and Node has pinned the module graph. So the answer
    // says which of the two happened instead of implying the better one.
    // **What was regenerated is a list, not a count.** Editing a class
    // rewrites one file; editing a CDS view rewrites the DDIC views, the
    // source class and the registry, and editing a published one rewrites
    // the whole service under it -- three files for a label, seven for a
    // renamed field, measured by fable-osd 2026-09-19 on a view that *owns*
    // fourteen. So no number is right for both, and a screen that says
    // "activated" while it has just rewritten the MPC and DPC of a service
    // nobody opened is hiding the part worth seeing.
    const before = snapshotOf(join(this.store.root, "gen"));
    const published = await this.store.publish();
    const regenerated = changedSince(before, join(this.store.root, "gen"));
    const objects = [
      ...regenerated.written.map((path) => generatedRow(path, "generated")),
      ...regenerated.removed.map((path) => generatedRow(path, "removed")),
    ];
    return {
      EV_ACTIVE: published?.ok === false ? "" : "X",
      EV_LIVE: published?.recycled === true ? "X" : "",
      EV_NOTE: published?.ok === false
        ? `the check held and the build did not: ${published?.transpile?.error ?? "no reason given"}`
        : `${published?.recycled === true
          ? `built and live (generation ${published?.generation ?? "?"})`
          : "built, and the process serving this screen still runs the code it started with -- it is replaced when it is next restarted"}`
          + (objects.length === 0 ? "" : `; ${objects.length} generated object${objects.length === 1 ? "" : "s"} rewritten`),
      EV_COUNT: "0",
      EV_MS: String(Date.now() - started),
      ET_ISSUE: [],
      ET_OBJECT: objects,
    };
  }
}

/** a file the generators wrote, as the object it is: the same row shape the
 *  list uses, because it answers the same question -- which objects, and in
 *  which files */
function generatedRow(path, state) {
  const key = objectOf(basename(path));
  const [type, name] = key === undefined ? ["", basename(path)] : key.split(" ");
  return {
    TYPE: type,
    NAME: name,
    PACKAGE: "",
    FILE: join("gen", path),
    WRITABLE: "",
    VERSION: state,
    CHANGED_AT: "",
  };
}

/** one issue, of the object it belongs to -- which is not always the object
 *  the person asked about */
function issueRow(issue, object) {
  return {
    OBJ_TYPE: String(object?.type ?? ""),
    OBJ_NAME: String(object?.name ?? ""),
    LINE: Number(issue.line ?? 0),
    // COL, not COLUMN: the field of ZOSD_ISSUE_S is COL, and a key the
    // caller's structure does not have is simply never assigned -- so the
    // column read as empty on every issue and nothing said why
    COL: Number(issue.column ?? 0),
    RULE: String(issue.rule ?? ""),
    MESSAGE: String(issue.message ?? ""),
  };
}

// Every answer carries every scalar. A screen reads what it reads whatever
// the command was, and a parameter left unassigned keeps whatever the caller
// happened to have in it -- which is the previous answer, and reads as this
// one.
const EMPTY = {
  EV_LIVE: "",
  EV_NOTE: "",
  EV_SOURCE: "",
  EV_FILE: "",
  EV_PACKAGE: "",
  EV_VERSION: "",
  EV_WRITABLE: "",
  EV_ACTIVE: "",
  EV_COUNT: "0",
  EV_MS: "0",
  EV_ERROR: "",
  ET_OBJECT: [],
  ET_ISSUE: [],
};
