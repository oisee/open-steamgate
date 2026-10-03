// Generated cockpit declarations are discovered like pack manifests.
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join, relative, resolve} from "node:path";
export function cockpitAppsOf(root = process.cwd(), folders = ["src"]) {
  const found = new Map();
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name === "cockpit.json") {
        const info = JSON.parse(readFileSync(path, "utf8"));
        found.set(info.app, {...info, name: info.app, dir, folder: relative(root, dir)});
      }
    }
  }
  for (const folder of folders) walk(resolve(root, folder));
  return [...found.values()];
}
