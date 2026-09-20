// Compose files are the source of truth; generated Markdown is committed.
import {readFileSync, writeFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const doc = new URL('docs/spin.md', root);
const start = '<!-- BEGIN GENERATED PORTAINER STACKS -->';
const end = '<!-- END GENERATED PORTAINER STACKS -->';
const original = readFileSync(doc, 'utf8');
if (original.split(start).length !== 2 || original.split(end).length !== 2 ||
    original.indexOf(end) < original.indexOf(start)) {
  throw new Error('Expected one ordered pair of generated stack markers in docs/spin.md');
}
const blocks = [['sqlite', 'SQLite'], ['duckdb', 'DuckDB'], ['hana', 'HANA Express']].map(([id, title]) => {
  const path = `docker/portainer/compose.${id}.yml`;
  const yaml = readFileSync(new URL(path, root), 'utf8').trimEnd();
  return `### ${title}: complete Portainer Stack\n\nSource: [${path}](../${path}). Copy the entire block into the Web editor.\n\n\`\`\`yaml\n${yaml}\n\`\`\``;
});
const generated = `${start}\n\n${blocks.join('\n\n')}\n\n${end}`;
const updated = original.slice(0, original.indexOf(start)) + generated +
  original.slice(original.indexOf(end) + end.length);
if (process.argv.includes('--check')) {
  if (updated !== original) {
    console.error('docs/spin.md is stale. Run: node scripts/sync-spin.mjs');
    process.exitCode = 1;
  } else console.log('spin.md matches all three Compose files');
} else if (updated !== original) {
  writeFileSync(doc, updated);
  console.log('Updated Compose blocks in docs/spin.md');
}
