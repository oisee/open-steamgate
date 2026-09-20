// Compose files are the source of truth; generated Markdown is committed.
import {readFileSync, writeFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const doc = new URL('docs/spin.md', root);
const original = readFileSync(doc, 'utf8');
const imageStart = '<!-- BEGIN GENERATED IMAGE STACKS -->';
const imageEnd = '<!-- END GENERATED IMAGE STACKS -->';
if (original.split(imageStart).length !== 2 || original.split(imageEnd).length !== 2 || original.indexOf(imageEnd) < original.indexOf(imageStart)) {
  throw new Error('Expected one ordered pair of generated image stack markers');
}
const imageBlocks = [['sqlite', 'SQLite'], ['duckdb', 'DuckDB'], ['hana', 'External HANA / HANA Express']].map(([id, title]) => {
  const path = `docker/compose.${id}.yml`;
  return `### Ready image: ${title}\n\nSource: [${path}](../${path}).\n\n\`\`\`yaml\n${readFileSync(new URL(path, root), 'utf8').trimEnd()}\n\`\`\``;
});
const updated = original.slice(0, original.indexOf(imageStart)) + `${imageStart}\n\n${imageBlocks.join('\n\n')}\n\n${imageEnd}` + original.slice(original.indexOf(imageEnd) + imageEnd.length);
if (process.argv.includes('--check')) {
  if (updated !== original) {
    console.error('docs/spin.md is stale. Run: node scripts/sync-spin.mjs');
    process.exitCode = 1;
  } else console.log('spin.md matches the ready-image Compose files');
} else if (updated !== original) {
  writeFileSync(doc, updated);
  console.log('Updated Compose blocks in docs/spin.md');
}
