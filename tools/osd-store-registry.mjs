// Generated consumers in a semantic check belong to the published system.
// gen/ is build scratch: generators overwrite it before the transpiler can
// fail, so its files can describe a generation that was never activated.
import * as abaplint from "@abaplint/core";
import {readFileSync, statSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";

const isGenerated = layer => layer.path === "gen" || layer.path.startsWith("gen/");
const isSource = file => /\.(abap|xml|asddls)$/.test(file);

// Include inode and ctime as well as mtime: replacement and a write followed
// by restored timestamps must both retire a cached parse.
export function fileIdentity(file) {
  try {
    const stat = statSync(file, {bigint: true});
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  } catch {return "absent";}
}

export function registryKey(root, layers, generation, excluded, configPath) {
  const hash = createHash("sha256");
  const add = value => hash.update(JSON.stringify(value)).update("\0");
  const file = path => add([path, fileIdentity(join(root, path))]);
  add([generation ?? null, excluded.map(re => re.toString()), configPath]);
  file(configPath);
  let inputs;
  if (generation !== undefined) {
    const base = join("build/by-input", generation);
    for (const path of [base, join(base, "source-inputs.json"), join(base, "manifest.json"),
      join(base, "source/.complete"), join(base, "source-shared")]) file(path);
    try {inputs = JSON.parse(readFileSync(join(root, base, "source-inputs.json"), "utf8"));} catch {}
  }
  for (const layer of layers) {
    add([layer.path, layer.library ?? false]);
    if (isGenerated(layer) && generation === undefined) continue;
    const files = isGenerated(layer) && inputs && typeof inputs === "object"
      ? Object.keys(inputs).filter(path => path.startsWith(layer.path + "/")) : layer.files;
    for (const path of files.filter(isSource).filter(path => !excluded.some(re => re.test("/" + path))).sort()) {
      if (!isGenerated(layer)) file(path);
      else {
        // The active reader can use snapshot bytes, shared bytes, a retained
        // pre-save copy, or matching working bytes for a legacy generation.
        for (const candidate of [join("build/by-input", generation, "source", path),
          join("build/inactive/active", path), path]) file(candidate);
        const digest = inputs?.[path];
        if (typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)) file(join("build/source-by-digest", digest));
      }
    }
  }
  return hash.digest("hex");
}

export function registryFiles(root, layer, files, generation, activeSource, excluded = []) {
  const generated = isGenerated(layer);
  // Without a published generation no gen/ file has proven provenance.
  // Omit generated consumers until a successful build retains their input.
  if (generated && generation === undefined) return [];
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
  return files.filter(file => isSource(file) && !excluded.some(re => re.test("/" + file))).flatMap(file => {
    const source = active ? activeSource(file) : readFileSync(join(root, file), "utf8");
    return active && source === "" ? [] : [new abaplint.MemoryFile("/" + file, source)];
  });
}
