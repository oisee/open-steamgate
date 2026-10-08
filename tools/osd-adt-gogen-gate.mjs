#!/usr/bin/env node
// ADT layer means every class/interface source under src/adt/ (recursively),
// including kernel helpers and exceptions. ADT name prefixes are a cross-check
// that also covers matching objects outside that directory.
import {readFileSync, readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const adtRoot = fileURLToPath(new URL('../src/adt/', import.meta.url));
const adtPrefix = /^Z(?:CL|IF|CX)_OSD_ADT/;

function sourceFiles(root) {
  return readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
    entry.isDirectory() ? sourceFiles(join(root, entry.name)) : [join(root, entry.name)]);
}

export function adtSourceNames(root = adtRoot) {
  return new Set(sourceFiles(root).filter(file => /\.(clas|intf)\.abap$/i.test(file))
    .map(file => file.split('/').pop().replace(/\.(clas|intf)\.abap$/i, '').toUpperCase()));
}

export function adtSourceHash(root = adtRoot) {
  const hash = createHash('sha256');
  for (const file of sourceFiles(root)) {
    hash.update(file.slice(root.length));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function checkGate(report, allowlist) {
  if (!report || !Array.isArray(report.classes)) throw new Error('invalid compile report: classes must be an array');
  if (!report.classes.length) throw new Error('empty compile report: no classes compiled (build produced nothing)');
  if (report.classes.some(name => typeof name !== 'string' || !name)) throw new Error('invalid compile report: class names must be nonempty strings');
  const names = adtSourceNames();
  const covered = entry => names.has(entry.split(/=>|:/)[0].toUpperCase()) || adtPrefix.test(entry.toUpperCase());
  if (!report.classes.some(covered)) throw new Error('empty ADT build: no covered classes compiled');
  if (report.adtSourceHash !== adtSourceHash()) throw new Error('stale compile report: ADT source fingerprint missing or differs');
  if (!Array.isArray(allowlist)) throw new Error('invalid allowlist: must be an array');
  const allowed = new Map(allowlist.map(entry => [`${entry.kind}: ${entry.entry}`, entry.reason]));
  const observed = new Set();
  const unmatched = [];
  for (const [kind, entries] of [["statement stub", report.statementStubs], ["method not compiled", report.methodsNotCompiled]]) {
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string')) throw new Error(`invalid compile report: ${kind}s must be an array of strings`);
    for (const entry of entries) {
      if (!covered(entry)) continue;
      const key = `${kind}: ${entry}`;
      if (observed.has(key)) unmatched.push(`${key}: duplicate`);
      observed.add(key);
      if (!allowed.has(key)) unmatched.push(key);
    }
  }
  const obsolete = [...allowed.keys()].filter(key => !observed.has(key));
  return {observed: [...observed], unmatched, obsolete};
}

function readJson(path, label) {
  let source;
  try { source = readFileSync(path, 'utf8'); }
  catch (error) { throw new Error(`${error.code === 'ENOENT' ? 'missing' : 'unreadable'} ${label} file: ${path}`); }
  try { return JSON.parse(source); }
  catch { throw new Error(`malformed JSON in ${label}: ${path}`); }
}

function main() {
  if (process.argv.length !== 4) {
    console.error("usage: node tools/osd-adt-gogen-gate.mjs <compile-report.json> <allowlist.json>");
    return 2;
  }
  try {
    const result = checkGate(readJson(process.argv[2], 'compile report'), readJson(process.argv[3], 'allowlist'));
    console.log(`ADT source coverage (${adtSourceNames().size} classes/interfaces): ${[...adtSourceNames()].sort().join(', ')}`);
    for (const entry of result.observed) console.log(`ADT compile gap: ${entry}`);
    for (const entry of result.unmatched) console.error(`not allowed: ${entry}`);
    for (const entry of result.obsolete) console.error(`allowlist entry no longer occurs: ${entry}`);
    console.log(`${result.observed.length} ADT statement stubs/methods not compiled; ${result.unmatched.length + result.obsolete.length} gate failures`);
    return result.unmatched.length || result.obsolete.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
