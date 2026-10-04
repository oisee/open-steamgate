// Generated consumers in a semantic check belong to the published system.
// gen/ is build scratch: generators overwrite it before the transpiler can
// fail, so its files can describe a generation that was never activated.
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {join} from "node:path";

export function registryFiles(root, layer, files, generation, activeSource, excluded = []) {
  const generated = layer.path === "gen" || layer.path.startsWith("gen/");
  const active = generated && generation !== undefined;
  if (active) {
    try {
      const inputs = JSON.parse(readFileSync(join(root, "build/by-input", generation, "source-inputs.json"), "utf8"));
      // Read the retained list as well as retained bytes: a failed generator
      // may remove a consumer or introduce one that never became active.
      files = Object.keys(inputs).filter(file => file.startsWith(layer.path + "/"));
    } catch {
      // Legacy generations can still prove individual files through the
      // store's activeSource reader. Unproven working bytes stay out.
    }
  }
  return files.filter(file => /\.(abap|xml|asddls)$/.test(file) && !excluded.some(re => re.test("/" + file))).flatMap(file => {
    const source = active ? activeSource(file) : readFileSync(join(root, file), "utf8");
    return active && source === "" ? [] : [new abaplint.MemoryFile("/" + file, source)];
  });
}
