// The dev loop: a save in any editor becomes a check, a build and a
// recycle — or a report, and nothing else.
//
// The disk is the other editor. Eclipse activates through the façade; a
// person with vim or VS Code saves a file, and until now nothing happened
// until somebody ran the transpile by hand and restarted the server. This
// closes that loop, with the same rule the façade's activation has: check
// the changed objects and everything that depends on them first, build only
// if that is clean, recycle only if the build succeeded. A failed step is
// reported with its message and leaves the running system exactly as it
// was, which docs/generations.md is the design of.
//
// What it does not do: watch webapp/ (express serves those files as they
// are — reload the browser), or data/ (a reseed replaces rows you may have
// made by hand; that is an explicit command). The store watches src/, local/
// and test/, and that is the whole list.
import {basename} from "node:path";
import {objectOf} from "./osd-inputs.mjs";

export function devLoop(options = {}) {
  const store = options.store;
  const log = options.log ?? ((m) => console.log(`dev: ${m}`));
  // an editor's save is one write or a few in a burst; a warm build is
  // short enough that a long wait for the burst to end would be most of it
  const quiet = options.debounce ?? Number(process.env.OSD_DEBOUNCE ?? (process.env.OSD_WARM === "1" ? 30 : 300));
  const publish = options.publish ?? (() => store.publish());
  const pending = new Map(); // file -> event
  let timer;
  let running;
  let dirty = false;

  // one pass: the files that changed since the last one, as objects
  async function run() {
    const files = [...pending.keys()];
    pending.clear();
    const objects = new Map();
    for (const file of files) {
      const key = objectOf(basename(file));
      if (key === undefined) {
        continue;
      }
      const [type, name] = key.split(" ");
      if (store.find(type, name) !== undefined) {
        objects.set(key, {type, name});
      }
    }
    log(`${files.length} file${files.length === 1 ? "" : "s"} changed${objects.size > 0 ? `: ${[...objects.keys()].join(", ")}` : ""}`);

    // with a warm registry the check is the build: the transpiler checks what
    // the change reaches and builds nothing if one of them is broken, in a
    // fraction of the ~3 s the check below costs
    // -- for classes and interfaces only: anything else is a cold build, and
    // a cold build is only as checked as the check below makes it
    const warmable = objects.size > 0 && [...objects.values()].every(({type}) => type === "CLAS" || type === "INTF");
    if (warmable && store.warm?.().compiler?.primed === true) {
      const started = Date.now();
      const checked = [...objects.values()].map(({type, name}) => store.warmActivation(type, name));
      const result = await publish();
      const t = result.transpile ?? {};
      if (result.ok !== true) {
        log(`${t.check ? "check" : "build"} failed after ${t.ms ?? "?"} ms: ${result.error ?? t.error ?? "see the output below"}; the running system is untouched`);
        return {ok: false, stage: t.check ? "check" : "build", result};
      }
      if (!store.completeActivations(checked)) {
        log("source changed during build; leaving the new edit inactive for the next pass");
        return {ok: false, stage: "changed", result};
      }
      const how = t.warm ? `warm, ${t.stale} object${t.stale === 1 ? "" : "s"}` : t.cached ? "reused" : "built";
      const live = result.hot ? `, swapped in ${result.ms} ms` : result.recycled ? `, recycled in ${result.ms} ms` : "";
      log(`${how} ${t.hash ?? ""} in ${t.ms ?? "?"} ms${live}; ${Date.now() - started} ms from the change`);
      return {ok: true, stage: "live", result};
    }

    // check first, the object and whoever depends on it; the registry sees
    // the system whole, so three changed files that broke against an
    // unchanged fourth are caught here, in seconds, before a build
    const started = Date.now();
    const broken = [];
    const checked = [];
    for (const {type, name} of objects.values()) {
      const result = store.activate(type, name);
      if (result.active !== true) {
        broken.push(result, ...(result.dependents ?? []));
      } else {
        checked.push(result);
      }
    }
    if (broken.length > 0) {
      for (const r of broken) {
        for (const issue of r.issues ?? []) {
          log(`  ${issue.file ?? r.name}:${issue.line ?? "?"}  ${issue.message}`);
        }
      }
      log(`check failed in ${Date.now() - started} ms: ${broken.length} object${broken.length === 1 ? "" : "s"} broken, nothing built, the running system is untouched`);
      return {ok: false, stage: "check", broken};
    }
    log(`check clean in ${Date.now() - started} ms, building`);

    const result = await publish();
    const t = result.transpile ?? {};
    if (result.ok !== true) {
      log(`build failed after ${t.ms ?? "?"} ms: ${result.error ?? t.error ?? "see the output below"}; live generation untouched`);
      if (t.output) {
        log(String(t.output).trimEnd().split("\n").slice(-12).join("\n"));
      }
      return {ok: false, stage: "build", result};
    }
    if (!store.completeActivations(checked)) {
      log("source changed during build; leaving the new edit inactive for the next pass");
      return {ok: false, stage: "changed", result};
    }
    const how = t.cached ? "reused" : "built";
    const live = result.recycled ? `, recycled in ${result.ms} ms` : ", nothing serving to recycle";
    log(`${how} ${t.hash ?? ""} (${t.objects ?? "?"} objects, ${t.ms ?? "?"} ms)${live}`);
    const serving = store.served?.running === true ? store.served.generation : undefined;
    if (serving !== undefined && serving !== t.hash) {
      log(`serving ${serving}, live ${t.hash}: not synchronized`);
    }
    return {ok: true, stage: "live", result};
  }

  // one pass at a time; a change that arrives mid-pass is picked up by the
  // next turn of the loop, and the caller gets the result of the last pass
  async function drain() {
    if (running !== undefined) {
      dirty = true;
      return running;
    }
    running = (async () => {
      let last;
      try {
        do {
          dirty = false;
          last = await run();
        } while (dirty || pending.size > 0);
      } finally {
        running = undefined;
      }
      return last;
    })();
    return running;
  }

  // watch: false leaves the disk alone and takes changes through touch(),
  // which is what a test wants and what a one-shot run wants
  let unsubscribe = () => {};
  if (options.watch !== false) {
    unsubscribe = store.onChange(({file, event}) => {
      pending.set(file, event);
      clearTimeout(timer);
      timer = setTimeout(() => {
        drain().catch((error) => log(`failed: ${error?.message ?? error}`));
      }, quiet);
    });
    store.watch();
  }
  log(`watching ${store.roots.filter((r) => r.writable).map((r) => r.path).join(", ")}; a save is a check, a build and a recycle`);

  return {
    // a change reported by hand, for a test or a one-shot run
    touch(file, event = "change") {
      pending.set(file, event);
      return drain();
    },
    stop() {
      clearTimeout(timer);
      unsubscribe();
      if (options.watch !== false) {
        store.unwatch();
      }
    },
  };
}
