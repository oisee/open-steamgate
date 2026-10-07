// Revision discovery includes overlays made before metadata was introduced.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {basename, dirname, join, relative} from 'node:path';
import {repositoryConfig, sourceFolder} from './osd-abapgit-config.mjs';
import {rootPackage} from './osd-source-layers.mjs';
import {objectOf} from './osd-inputs.mjs';
const readJSON = file => {try {return JSON.parse(readFileSync(file, 'utf8'));} catch {return {};}};
const filesOf = (folder, files = []) => {
  if (existsSync(folder)) for (const e of readdirSync(folder, {withFileTypes: true})) {
    const file = join(folder, e.name);
    if (e.isDirectory()) filesOf(file, files);
    else if (e.isFile() && !e.name.startsWith('.osd-')) files.push(file);
  }
  return files;
};
export function orphanedOverlays(root) {
  const home = join(root, 'local/overlays'), mounted = readJSON(join(home, '.osd-mounts.txt'));
  if (!existsSync(home)) return [];
  const current = new Set(Object.values(mounted));
  const result = [];
  for (const e of readdirSync(home, {withFileTypes: true})) {
    if (!e.isDirectory() || !/^[a-f0-9]{64}$/.test(e.name) || current.has(e.name)) continue;
    const path = join(home, e.name), base = join(root, 'build/source-layers', e.name);
    const meta = readJSON(join(home, e.name + '.meta.txt'));
    let source, key = meta.key;
    if (existsSync(join(base, '.abapgit.xml'))) {
      source = sourceFolder(base, repositoryConfig(base));
      key ??= rootPackage(source);
    }
    const changed = new Set();
    for (const file of filesOf(path)) {
      const name = relative(path, file), original = source && join(source, name);
      if (original && existsSync(original) && readFileSync(file).equals(readFileSync(original))) continue;
      // A class's includes count as one object. Package folders stay distinct.
      const object = objectOf(basename(name));
      changed.add(object?.startsWith('DEVC ') ? `DEVC ${relative(path, dirname(file))}` : object ?? name);
    }
    if (changed.size) result.push({sha256: e.name, path: relative(root, path), key, count: changed.size,
      sameLayer: key !== undefined && Object.hasOwn(mounted, key)});
  }
  return result.sort((a,b) => a.sha256.localeCompare(b.sha256));
}
export function overlayWarning(overlay) {
  return `WARNING: ${overlay.count} changed objects on old ZIP sha256 ${overlay.sha256} are not applied: ${overlay.path}. Recover by opening this overlay directory and manually diffing/reapplying it against the retained build/source-layers/<old-sha> sources, or mount the original ZIP to resume its edits.`;
}
export function reportOrphanedOverlays(root, say = console.warn) {
  for (const overlay of orphanedOverlays(root).filter(o => o.sameLayer)) say(overlayWarning(overlay));
}
