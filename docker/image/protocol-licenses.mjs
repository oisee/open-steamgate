import {readFileSync, readdirSync, existsSync, writeFileSync} from "node:fs";
import {join, basename} from "node:path";
const text = readFileSync('/out/go-modules.json', 'utf8');
const modules = JSON.parse('[' + text.trim().replace(/}\s*{/g, '},{') + ']');
const used = new Set(readFileSync('/out/go-used-modules.txt', 'utf8').trim().split('\n').filter(Boolean));
const report = {modules: [], blockers: []};
for (const m of modules) {
  if (!used.has(m.Path)) continue;
  const actual = m.Replace ?? m;
  let files;
  if (actual.Dir?.startsWith('/src/')) {
    files = [`/out/licenses/${basename(actual.Dir)}.LICENSE`];
  } else {
    const dir = join('/out/licenses', actual.Dir ?? '/missing');
    files = existsSync(dir) ? readdirSync(dir).filter(f => /^(license|copying|notice)/i.test(f)).map(f => join(dir, f)) : [];
  }
  const contents = files.filter(existsSync).map(f => readFileSync(f, 'utf8')).join('\n');
  const recognized = /MIT License|Permission is hereby granted|Apache License|Redistribution and use|Permission to use, copy, modify/i.test(contents);
  report.modules.push({name: m.Path, version: actual.Version ?? 'source pin', files, recognized});
  if (!recognized) report.blockers.push(`Review Go module license: ${m.Path}`);
}
for (const name of used) if (!report.modules.some(m => m.name === name)) report.blockers.push(`Missing Go module: ${name}`);
writeFileSync('/out/licenses.json', JSON.stringify(report, null, 2) + '\n');
