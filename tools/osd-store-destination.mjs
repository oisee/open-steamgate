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
import {withoutHostPaths} from "./osd-build-issues.mjs";
import {PARENT_SYSTEM_KINDS, CHILD_SYSTEM_KINDS} from "./osd-system-kinds.mjs";
import {given, givenText, fill} from "./osd-destination.mjs";
import {snapshotOf, changedSince} from "./osd-generation-diff.mjs";
import {objectOf} from "./osd-inputs.mjs";
import {basename, join} from "node:path";

// TOKENS was one more until 2026-09-25: the editor colours in ABAP now
// (ZCL_OSD_ABAP_TOKENS, a word list), the same on every host, so the one
// command that needed a parse per display is gone (host-tools review S1/C2)
export const COMMANDS = ["LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "CAPABILITIES", "HISTORY", "REVISION", "OBJECT", "COMMANDS", "SYSTEM", "PACKAGE", "CHECKRUN", "PARSE", "PACKAGES", "SEARCH"];

/** What this host can do, as the screen asks it (CAPABILITIES, EV_NOTE):
 *  the editor draws a button only for a command named here. Node holds the
 *  compiler and the build, so it offers all five; a host that cannot check
 *  or activate (OSGo, a built binary) leaves them out and the screen shows
 *  no button that would only be refused (host-tools review 2026-09-25, D2). */
export const CAPABILITIES = ["LIST", "READ", "WRITE", "CHECK", "ACTIVATE", "HISTORY", "REVISION", "CHECKRUN", "PARSE"];

const PARSE_KINDS = {
  UNIT_PLAN: async (store, input) => {
    const {unitPlan} = await import("./osd-unit.mjs");
    return unitPlan(store, String(input.type ?? "").toUpperCase(),
      String(input.name ?? "").toUpperCase(), {risk: input.risk === true});
  },
};

// SYSTEM answers facts about this system rather than about the tree, one
// kind per call, as JSON in EV_JSON (docs/adt-abap-port/port-map.md,
// section 3). Slice 1 of the ADT facade in ABAP asks IDENTITY: who this
// system says it is to an ADT client.
//
// The answer belongs to the facade instance whose request is running the
// ABAP, not to the process -- a test mounts several -- so the caller binds
// its answers for the length of one call (withSystem, used by
// tools/adt-abap-front.mjs) and the binding rides the call's async context
// through the work-process queue to here. Nothing is set process-wide, and
// a call nobody bound is refused: a plausible identity from the
// environment would be a wrong answer that looks right.
// SYSTEM needs no store and does not open one: opening it parses the tree.
//
// Slice 2 adds two kinds that are the ADT session's rather than the
// system's, answered by the same per-call binding because only the facade
// instance knows which session a request belongs to: LOCK_HANDLE (IV_NAME
// "TYPE NAME": the session's handle for an object its ABAP LOCK has just
// enqueued), LOCK_RELEASE (IV_NAME the handle: forget it, answer the
// object), SESSION (does the request's session hold state) and LOCK_HOLDER
// (IV_NAME "TYPE NAME": is the holder a live session; a dead one is ended).
// They go when the session moves into ABAP.
const SYSTEM_KINDS = ["IDENTITY", "LOCK_HANDLE", "LOCK_RELEASE", "SESSION", "LOCK_HOLDER"];
let systemCalls;
try {
  if (typeof process !== "undefined" && process.versions?.node !== undefined) {
    const {AsyncLocalStorage} = await import(/* webpackIgnore: true */ "node:async_hooks");
    systemCalls = new AsyncLocalStorage();
  }
} catch {
  systemCalls = undefined;
}

/** Run work with `answers` ((kind, name, json) => value; throw to refuse) bound
 *  as the SYSTEM answers of every STORE call it makes, and `store` (the
 *  facade instance's ObjectStore, port-map risk 12) for every STORE command. */
export function withSystem(answers, work, {store, deferActivate, oneRuntime} = {}) {
  if (systemCalls === undefined) throw new Error("SYSTEM needs an async context (Node or Bun)");
  const inherited = systemCalls.getStore();
  return systemCalls.run({answers, oneRuntime: oneRuntime ?? inherited?.oneRuntime, deferActivate: deferActivate ?? inherited?.deferActivate,
    store: store ?? inherited?.store}, work);
}

export const currentSystemAnswers = () => systemCalls?.getStore()?.answers;
export const oneRuntimeEnabled = () => (typeof process !== "undefined" && process.env?.OSD_ADT_ONE_RUNTIME === "1")
  || systemCalls?.getStore()?.oneRuntime === true;

export class StoreDestination {
  // Read the current request binding, never cache it on the destination.
  oneRuntimeEnabled() { return oneRuntimeEnabled(); }

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

  async execute(parameters) {
    const signature = {exporting: parameters};
    let answer;
    try { answer = await this.#answer(givenText(signature, "IV_COMMAND", "LIST").toUpperCase(), signature); }
    catch (error) { answer = refusal(error); }
    if (answer.EV_ERROR && !answer.EV_JSON) answer = {...answer, ...refusal(answer.EV_ERROR)};
    return {...EMPTY, ...answer};
  }

  async call(name, signature) {
    fill(signature, await this.execute(signature.exporting ?? signature.EXPORTING ?? {}));
  }

  async #answer(command, signature) {
    if (command === "COMMANDS") return {EV_JSON: JSON.stringify({commands: COMMANDS}), EV_NOTE: COMMANDS.join(" ")};
    if (command === "CAPABILITIES") return {EV_NOTE: CAPABILITIES.join(" ")};
    if (!COMMANDS.includes(command)) return refusal(`unknown store command ${command}`, "NOT_SUPPORTED");
    if (command === "SYSTEM") {
      return this.#system(givenText(signature, "IV_TYPE").toUpperCase(), givenText(signature, "IV_NAME"), givenText(signature, "IV_JSON"));
    }
    if (command === "OBJECT") {
      return this.#object(givenText(signature, "IV_TYPE").toUpperCase(), givenText(signature, "IV_NAME"));
    }
    const started = Date.now();
    try {
      // Kind refusals require no tree and must not open the default store.
      let parseInput;
      if (command === "PARSE") {
        try { parseInput = JSON.parse(givenText(signature, "IV_JSON") || "{}"); }
        catch { return refusal("PARSE needs IV_JSON {kind, ...}", "NOT_SUPPORTED"); }
        if (!Object.hasOwn(PARSE_KINDS, parseInput?.kind)) return refusal(`unknown PARSE kind ${parseInput?.kind ?? "(none)"}`, "NOT_SUPPORTED");
      }
      const store = systemCalls?.getStore()?.store ?? await this.#open();
      if (store === undefined) {
        // Named, and with the reason. "No store" answered as an empty list is
        // a screen that says the system is empty, which is a different and
        // false statement.
        return {EV_ERROR: `no object store here: ${this.reason}`};
      }
      const type = givenText(signature, "IV_TYPE").toUpperCase();
      const name = givenText(signature, "IV_NAME").toUpperCase();
      const include = givenText(signature, "IV_INCLUDE", "main") || "main";
      const source = given(signature, "IV_SOURCE");
      switch (command) {
        case "PARSE": {
          return {EV_JSON: JSON.stringify(await PARSE_KINDS[parseInput.kind](store, parseInput))};
        }
        case "CHECKRUN": {
          const {checkRunReport} = await import("./adt-checkrun.mjs");
          return {EV_JSON: JSON.stringify(checkRunReport(store, {type, name,
            include: givenText(signature, "IV_INCLUDE") || undefined,
            source: givenText(signature, "IV_FILTER") === "SOURCE" ? givenText(signature, "IV_SOURCE") : undefined}))};
        }
        case "PACKAGES": {
          const input = JSON.parse(givenText(signature, "IV_JSON"));
          const packages = store.packages();
          if (["lines", "vfs-lines"].includes(input.format)) {
            const field = (value) => String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\t", "\\t").replaceAll("\n", "\\n");
            const records = [];
            const row = (...fields) => records.push(fields.map(field).join("\t"));
            for (const pkg of packages) {
              row("P", pkg.name, pkg.parent, pkg.description, pkg.library ? "X" : "", pkg.parent === undefined ? "X" : "");
              if (input.format === "vfs-lines") {
                for (const child of pkg.subpackages ?? []) row("C", pkg.name, child);
                for (const object of store.package(pkg.name).objects) {
                  row("O", pkg.name, object.type, object.name, object.description ?? object.name, object.library ? "X" : "");
                }
              }
            }
            return {EV_SOURCE: records.join("\n")};
          }
          return {EV_JSON: JSON.stringify(packages.map((pkg) => ({
            name: pkg.name, parent: pkg.parent, description: pkg.description, library: pkg.library, subpackages: pkg.subpackages})))};
        }
        case "SEARCH": {
          const input = JSON.parse(givenText(signature, "IV_JSON"));
          const rows = store.search(input.seed ?? "", {
            type: input.type || undefined, max: input.limit === null ? NaN : Number(input.limit),
          });
          if (input.format === "lines") return {EV_SOURCE: rows.map((o) => [o.type, o.name, o.library ? "X" : ""].join("\t")).join("\n")};
          return {EV_JSON: JSON.stringify(rows)};
        }
        case "PACKAGE": {
          const input = JSON.parse(givenText(signature, "IV_JSON"));
          if (!["raw", "local"].includes(input.mode)) return refusal("PACKAGE mode must be raw or local", "INVALID_NAME");
          const wanted = String(input.name ?? "").toUpperCase();
          const {packageOf} = await import("./adt-documents.mjs");
          const pkg = input.mode === "local" ? packageOf(store, wanted, {user: input.user}) : store.package(wanted);
          const descriptions = new Map(store.packages().map((p) => [p.name, p.description ?? ""]));
          return {EV_JSON: JSON.stringify({found: true, name: pkg.name, parent: pkg.parent,
            description: pkg.description, library: pkg.library === true,
            subpackages: (pkg.subpackages ?? []).map((name) => ({name, description: descriptions.get(name) ?? ""})),
            objects: (pkg.objects ?? []).map((o) => ({type: o.type, name: o.name, library: o.library === true, version: o.version}))})};
        }
        case "LIST": return this.#list(signature, store);
        case "READ": return this.#read(type, name, include, store);
        case "WRITE": return this.#write(type, name, include, source, started, store);
        case "CHECK": return this.#check(type, name, include, source, started, store);
        case "ACTIVATE": return await this.#activate(type, name, started, store);
        case "HISTORY": return await this.#history(type, name, include, signature, store);
        case "REVISION": return await this.#revision(type, name, include, givenText(signature, "IV_REVISION"), store);
      }
    } catch (error) {
      // the store's own refusals -- NotFound, ReadOnly, NotSupported -- are
      // answers a person can act on, so they are carried through as they are
      // written rather than turned into "failed"
      return {...refusal(error), EV_MS: String(Date.now() - started)};
    }
  }

  // OBJECT: does the object exist, under which name, and may it be changed
  // (port-map section 3; slice 2 asks only these three). From the store the
  // call is bound to when a facade instance bound one, else this one's.
  async #object(type, name) {
    const store = systemCalls?.getStore()?.store ?? await this.#open();
    if (store === undefined) {
      return {EV_ERROR: `no object store here: ${this.reason}`};
    }
    try {
      const entry = store.find(type, name);
      return {EV_JSON: JSON.stringify(entry === undefined ? {found: false}
        : {found: true, type: entry.type, name: entry.name, writable: entry.writable !== false,
          package: entry.package, packages: entry.packages ?? [], ...store.stateOf(entry),
          changedBy: entry.changedBy, includes: entry.type === "CLAS" ? store.classIncludes(entry.name) : []})};
    } catch (error) {
      return refusal(error);
    }
  }

  async #system(kind, name, json) {
    if (SYSTEM_KINDS.includes(kind) === false && !(oneRuntimeEnabled() && (PARENT_SYSTEM_KINDS.has(kind) || CHILD_SYSTEM_KINDS.has(kind)))) {
      return {EV_ERROR: `unknown SYSTEM kind ${kind || "(none)"}`};
    }
    const bound = systemCalls?.getStore();
    if (bound?.answers === undefined) {
      return {EV_ERROR: `nothing answers SYSTEM ${kind} for this call: it is bound per ADT facade instance (withSystem)`};
    }
    try {
      const value = await bound.answers(kind, name, json);
      if (value === undefined) return {EV_ERROR: `SYSTEM ${kind} has no answer here`};
      return typeof value?.raw === "string" ? {EV_SOURCE: value.raw} : {EV_JSON: JSON.stringify(value)};
    } catch (error) {
      return refusal(error);
    }
  }

  #list(signature, store) {
    const type = givenText(signature, "IV_TYPE").toUpperCase();
    const filter = givenText(signature, "IV_FILTER").toUpperCase();
    const limit = Number(givenText(signature, "IV_LIMIT")) || this.limit;
    const matching = store.list()
      .filter((entry) => filter === "" || entry.name.includes(filter));
    // **The tally is of what the FILTER matched, before the type narrows
    // it**, and it is a structure of its own rather than a number pushed
    // into an object row: a type and a count are not an object.
    //
    // It exists because the list is cut at a limit and the types are sorted
    // together, so 607 classes filled the first 300 rows and not one CDS
    // view was visible -- the screen said "300 shown of 1140" and was
    // honest, and a person who did not already know to ask for DDLS still
    // could not find one (fable-osd, using the screen, 2026-09-19). With the
    // tally the cut hides the tail of one type instead of hiding whole
    // types.
    const tally = new Map();
    for (const entry of matching) {
      tally.set(entry.type, (tally.get(entry.type) ?? 0) + 1);
    }
    const all = matching
      .filter((entry) => type === "" || entry.type === type)
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
        .map((entry) => store.find(entry.type, entry.name) ?? entry)
        .map((entry) => this.#row(entry, store)),
      ET_TYPE: [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([kind, count]) => ({TYPE: kind, COUNT: count})),
    };
  }

  #row(entry, store) {
    const state = store.stateOf(entry);
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

  // **The versions of an object are its file's commits** (docs/backlog/adt.md,
  // "Versions of an object, read out of git"): stored nowhere, git answers.
  // The file is the one the object store resolved, the winning layer's. The
  // author is a SAP-style user name, never an e-mail. Outside git the answer
  // says "no history" and why, and EV_COUNT stays empty: a count of 0 would
  // read as "never changed".
  // git is loaded on the call, not with the module: the preview bundles this
  // destination and has no child_process (webpack.config.cjs ignores it)
  async #history(type, name, include, signature, store) {
    const {gitObjectHistory, gitObjectState} = await import("./osd-git-history.mjs");
    const {statSync} = await import("node:fs");
    const entry = store.read(type, name, include);
    if (entry.empty) return {EV_FILE: "", EV_NOTE: "the include has no file", EV_COUNT: "0"};
    const asked = Number(givenText(signature, "IV_LIMIT"));
    const limit = Number.isInteger(asked) && asked > 0 ? asked : 50;
    const history = gitObjectHistory(store.root, entry.file, limit);
    const commits = history.available === true ? history.entries : [];
    let modified = true;
    try {
      modified = commits.length === 0 || gitObjectState(store.root, entry.file).status !== "clean";
    } catch {
      // A tree git cannot read has only its working version.
    }
    let changed = new Date(0);
    try {
      changed = statSync(join(store.root, entry.file)).mtime;
    } catch {
      // A missing include has no file time.
    }
    const state = modified ? "modified" : "clean";
    const fields = {EV_FILE: String(entry.file ?? ""), EV_STATE: state, EV_CHANGED: changed.toISOString()};
    if (history.available !== true) {
      return {...fields, EV_NOTE: `no history: ${history.reason}`, EV_COUNT: ""};
    }
    return {
      ...fields,
      EV_COUNT: String(history.entries.length),
      ET_REVISION: history.entries.map((e) => revisionRow(e)),
    };
  }

  async #revision(type, name, include, revision, store) {
    const {gitObjectRevisionAt} = await import("./osd-git-history.mjs");
    const entry = store.read(type, name, include);
    const found = gitObjectRevisionAt(store.root, entry.file, revision);
    return {EV_SOURCE: found.source, EV_FILE: found.path, EV_VERSION: revision.toLowerCase().slice(0, 12)};
  }

  #read(type, name, include, store) {
    const read = store.read(type, name, include);
    return {
      EV_SOURCE: read.source,
      EV_JSON: JSON.stringify({name: read.name, changedBy: read.changedBy, empty: read.empty === true}),
      EV_FILE: String(read.file ?? ""),
      EV_PACKAGE: String(read.package ?? ""),
      EV_WRITABLE: read.writable === false ? "" : "X",
      EV_VERSION: store.stateOf(read).version,
      ET_OBJECT: [this.#row(read, store)],
    };
  }

  #write(type, name, include, source, started, store) {
    if (source === undefined) {
      // not "an empty source": a screen that posts a form with no text area
      // in it would otherwise silently empty the object it was showing
      return {EV_ERROR: "WRITE without IV_SOURCE: nothing was written"};
    }
    const written = store.write(type, name, String(source), include);
    return {
      EV_FILE: String(written.file ?? ""),
      EV_PACKAGE: String(written.package ?? ""),
      EV_VERSION: written.version ?? "inactive",
      EV_WRITABLE: "X",
      EV_MS: String(Date.now() - started),
    };
  }

  #check(type, name, include, source, started, store) {
    const options = source === undefined ? {} : {source: String(source), include};
    const result = store.check(type, name, options);
    return {
      EV_ACTIVE: result.issues.length === 0 ? "X" : "",
      EV_COUNT: String(result.issues.length),
      EV_MS: String(Date.now() - started),
      ET_ISSUE: result.issues.map((issue) => issueRow(issue, result)),
    };
  }

  async #activate(type, name, started, store) {
    const result = store.activate(type, name);
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
    let failureEntries;
    const publish = async () => {
      const before = snapshotOf(join(store.root, "gen"));
      const published = await store.publish({activate: [{type, name}]});
      const committed = published?.ok !== false && await store.completeActivation(result, published?.transpile?.built);
      if (!committed) {
        const issues = published?.transpile?.issues ?? [];
        if (published?.ok === false && published?.transpile?.check === true && issues.length) {
          const same = o => String(o.name).toUpperCase() === name.toUpperCase();
          failureEntries = [{type, name, issues: issues.filter(same).flatMap(o => o.issues ?? [])}, ...issues.filter(o => !same(o))];
        } else {
          const why = published?.ok === false ? published.error ?? published.transpile?.error ?? "the build after activation failed"
            : "source changed during activation; check and activate again";
          failureEntries = [{type, name, issues: [{message: withoutHostPaths(String(why), store.root).split("\n")[0].slice(0, 500), severity: "E", line: 1, column: 1}]}];
        }
      }
      const regenerated = changedSince(before, join(store.root, "gen"));
      const objects = [
        ...regenerated.written.map((path) => generatedRow(path, "generated")),
        ...regenerated.removed.map((path) => generatedRow(path, "removed")),
      ];
      return {
        EV_ACTIVE: committed ? "X" : "",
        EV_LIVE: committed && published?.recycled === true ? "X" : "",
        EV_NOTE: published?.ok === false
          ? `the check held and the build did not: ${published?.error ?? published?.transpile?.error ?? "no reason given"}`
          : !committed ? "source changed during activation; check and activate again"
          : `${published?.recycled === true
            ? `built and live (generation ${published?.generation ?? "?"})`
            : "built, and the process serving this screen still runs the code it started with -- it is replaced when it is next restarted"}`
            + (objects.length === 0 ? "" : `; ${objects.length} generated object${objects.length === 1 ? "" : "s"} rewritten`),
        EV_COUNT: "0",
        EV_MS: String(Date.now() - started),
        ET_ISSUE: [],
        ET_OBJECT: objects,
      };
    };
    const defer = systemCalls?.getStore()?.deferActivate;
    if (defer !== undefined) {
      defer(async () => ({...await publish(), type, name, failureEntries}));
      return {EV_ACTIVE: "X", EV_LIVE: "", EV_NOTE: "live after the step", EV_COUNT: "0", EV_MS: String(Date.now() - started)};
    }
    return publish();
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
  EV_STATE: "",
  EV_CHANGED: "",
  EV_PACKAGE: "",
  EV_VERSION: "",
  EV_WRITABLE: "",
  EV_ACTIVE: "",
  EV_COUNT: "0",
  EV_MS: "0",
  EV_ERROR: "",
  EV_JSON: "",
  ET_OBJECT: [],
  ET_ISSUE: [],
  ET_TYPE: [],
  // kept while ZOSD_STORE still declares it; nothing fills it since TOKENS left
  ET_TOKEN: [],
  ET_REVISION: [],
};

/** A git author as a SAP user name: upper case, A-Z 0-9 _, at most 12 */
export function sapUserOf(author) {
  const user = String(author ?? "").replace(/[^A-Za-z0-9_]/g, "").toUpperCase().slice(0, 12);
  return user === "" ? "UNKNOWN" : user;
}

function revisionRow(entry) {
  const at = new Date(entry.authoredAt);
  const valid = !Number.isNaN(at.getTime());
  const iso = valid ? at.toISOString() : "";
  return {
    REVISION: entry.revision,
    SHORT: entry.short,
    AUTHOR: sapUserOf(entry.author),
    // UTC, as a system's DATUM / ZEIT pair
    DATE: valid ? iso.slice(0, 10).replace(/-/g, "") : "00000000",
    TIME: valid ? iso.slice(11, 19).replace(/:/g, "") : "000000",
    SUBJECT: String(entry.subject ?? "").slice(0, 80),
    SUBJECT_FULL: String(entry.subject ?? ""),
  };
}

// Unknown host failures are INTERNAL, never guessed from their message.
function refusal(error, code = error?.code) {
  const message = String(error?.message ?? error);
  const known = ["NOT_FOUND", "CONFLICT", "READ_ONLY", "NOT_SUPPORTED", "INVALID_NAME", "INTERNAL"];
  return {EV_ERROR: message, EV_JSON: JSON.stringify({error: {code: known.includes(code) ? code : "INTERNAL", message}})};
}
