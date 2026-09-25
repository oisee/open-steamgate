// objects.mjs: the ABAP objects of OSGo's program by origin: libs (.local/lars and the filtered abapGit) vs the tree's layers
import {readdirSync} from "node:fs";
import {join} from "node:path";
const {layers, libs, hidden} = await import("../osg-build.mjs");
const walk = (d) => readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const names = (dirs) => [...new Set(dirs.flatMap((d) => { try { return walk(d); } catch { return []; } }).filter((f) => !hidden.has(f) && /\.(clas|intf)\.abap$|\.fugr\.xml$/.test(f)).map((f) => (/\.fugr\.xml$/.test(f) ? "FUGR_" : "") + f.split("/").pop().split(".")[0].toUpperCase().replaceAll("#", "_").replaceAll("/", "_")))];
const lib = names(libs);
const libSet = new Set(lib);
const tree = names(layers).filter((n) => !libSet.has(n));
console.log(JSON.stringify({lib, tree}));
