import {readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadCases} from './run.mjs';
// Only this runner's versioned schema is accepted; other suite JSON is unrelated.
export function mergeSquare(cases, reports) {
  const latest = new Map();
  for (const report of reports) {
    if (report.schema !== 1 || !['a4h', 'js', 'osgo'].includes(report.target) || !Array.isArray(report.cases)) continue;
    for (const row of report.cases) {
      const key = `${report.target}:${row.id}`, previous = latest.get(key);
      if (!previous || String(report.createdAt) > previous.createdAt) latest.set(key, {...row, createdAt: report.createdAt});
      else if (report.createdAt === previous.createdAt && (row.status !== previous.status || row.observed !== previous.observed))
        throw new Error(`conflicting results for ${key}`);
    }
  }
  return cases.map(c => ({id: c.id, point: c.point, title: c.title,
    ...Object.fromEntries(['a4h', 'js', 'osgo'].map(target => {
      const r = latest.get(`${target}:${c.id}`);
      return [target, r ? {...r} : {status: 'not-measured', observed: false}];
    }))}));
}
export function markdown(rows) {
  const cell = r => `${r.status}${r.observed === false && r.status !== 'not-measured' ? ' (unobserved)' : ''}`;
  return ['| Point / case | A4H | JS | osgo |', '| --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.point} / ${r.id} | ${cell(r.a4h)} | ${cell(r.js)} | ${cell(r.osgo)} |`)].join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const dir = process.argv[2] ?? 'suite-results';
    const reports = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    console.log(markdown(mergeSquare(await loadCases(), reports)));
  } catch (e) {console.error(e.message); process.exitCode = 2;}
}
