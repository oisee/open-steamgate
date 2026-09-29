// Produce a temporary class-filtered copy of the transpiler's ordinary Unit
// entry point for timing an exact intersection. The generated Node path and
// its source are left untouched.
import {readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {home} from "./home.mjs";

const args = process.argv.slice(2);
const classes = args.flatMap((x, i) => x === "--class" ? [args[i + 1].toUpperCase()] : []);
if (!classes.length) throw new Error("pass at least one --class");
const source = join(home, "output", "index.mjs");
const target = join(home, "output", "_unit_selected.mjs");
const before = readFileSync(source, "utf8");
const needle = "for (const st of getData())";
if (before.split(needle).length !== 2) throw new Error("the transpiler Unit entry point changed; inspect its run loop");
const after = before.replace(needle, `for (const st of getData().filter(st => new Set(${JSON.stringify(classes)}).has(st.objectName.toUpperCase())))`);
writeFileSync(target, after);
console.log(target);
