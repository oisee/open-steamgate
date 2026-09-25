// The swap, on the serving side: a warm build (tools/osd-warm.mjs) names
// the modules it rebuilt, and this process loads them next to the ones it
// already has, instead of being replaced by a new process (~3 s here, most
// of it the start-up's own checks).
//
// Why it works: a transpiled module registers its class itself
// (`abap.Classes['ZCL_X'] = zcl_x`) and runs its class constructor when it
// is evaluated, and everything else reaches a class through that table at
// call time. The only bindings a module holds are its static imports -- the
// superclass, the exception classes -- and a warm build refuses unless every
// importer of a rebuilt module is rebuilt with it, so no module left in place
// holds one to an old instance.
//
// What it means, and why it is the system's behaviour rather than a shortcut:
// the next dialog step that asks for the class gets the new one, with its
// class constructor run again for it, the way activation gives a new load to
// new sessions; an object created before the swap keeps the code it was
// created with, the way a running session does. It differs in one respect,
// written down in ANORMALIES.md: a system runs a class constructor at the
// first access to the class, and this runs it at the swap.
//
// Each swap writes the rebuilt modules to build/hot/<generation>/, with
// their imports rewritten to the instance each name has in this process:
// the one loaded at start, or an earlier swap's copy. The file URL carries
// the swap's number, so a module swapped back to a generation seen before is
// evaluated again rather than answered from the module cache. Old instances
// stay in the module map for the life of the process, which is why the
// supervisor recycles after a number of swaps (docs/warm-compile.md).
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {basename, dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

/**
 * The text of a rebuilt module, with every relative import pointed at the
 * instance this process should bind it to.
 *   text      the module as the new generation holds it
 *   from      the new generation's output folder (real path)
 *   name      the module's file name
 *   urlOf     (name) => the URL of the instance a module outside the swap has
 *   hotUrlOf  (name) => the URL of a module inside the swap, or undefined
 */
export function rewrite(text, {from, name, urlOf, hotUrlOf}) {
  const target = (spec) => {
    const path = resolve(from, decodeURIComponent(spec));
    if (dirname(path) === from) {
      const m = basename(path);
      return hotUrlOf(m) ?? urlOf(m);
    }
    // outside output/ (the setup hook): the file the first load reached
    // through the generation's link, which is one instance for everyone
    return pathToFileURL(realpathSync(path)).href;
  };
  return text
    .replace(/\bimport\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g, (_, spec) => `import(${JSON.stringify(target(spec))})`)
    .replace(/\bfrom\s+"(\.{1,2}\/[^"]+)"/g, (_, spec) => `from ${JSON.stringify(target(spec))}`)
    // a module that reads files beside itself (the W3MI loader) reads them
    // where the generation has them, not beside the copy
    .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(join(from, name)).href))
    .replace(/^\/\/# sourceMappingURL=(\S+)$/m, (_, map) => `//# sourceMappingURL=${pathToFileURL(join(from, decodeURIComponent(map))).href}`);
}

/**
 * false for a generation a warm build made and nobody has compared with a
 * cold transpile yet (the note tools/osd-warm.mjs writes beside it), true once
 * somebody has, undefined for a generation a cold build made
 */
export function warmVerdict(generationDir) {
  try {
    return JSON.parse(readFileSync(`${generationDir}.warm.json`, "utf8")).verified === true;
  } catch {
    return undefined;
  }
}

export class HotLoader {
  constructor(root) {
    this.root = root;
    // the folder the modules were loaded from at start, as Node resolved it
    this.base = realpathSync(join(root, "output"));
    this.generation = basename(dirname(this.base));
    this.loaded = new Map();
    this.swaps = 0;
    this.since = undefined;
  }

  urlOf(name) {
    return this.loaded.get(name) ?? pathToFileURL(join(this.base, name)).href;
  }

  async swap({generation, modules}) {
    const started = Date.now();
    const from = realpathSync(join(this.root, "build", "by-input", generation, "output"));
    const dir = join(this.root, "build", "hot", generation);
    mkdirSync(dir, {recursive: true});
    const n = this.swaps + 1;
    const inSwap = new Set(modules);
    const hotUrlOf = (m) => (inSwap.has(m) ? `${pathToFileURL(join(dir, m)).href}?swap=${n}` : undefined);
    for (const m of modules) {
      const text = rewrite(readFileSync(join(from, m), "utf8"), {from, name: m, urlOf: (x) => this.urlOf(x), hotUrlOf});
      writeFileSync(join(dir, m), text);
    }
    // in the init script's order; each import brings the swapped modules it
    // imports with it, and a second import of one is the same instance
    for (const m of modules) {
      await import(hotUrlOf(m));
    }
    for (const m of modules) this.loaded.set(m, hotUrlOf(m));
    this.swaps = n;
    this.since = this.since ?? started;
    this.generation = generation;
    return {ms: Date.now() - started, modules: modules.length, swaps: n};
  }
}
