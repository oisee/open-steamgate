// Navigation tests deliberately read the optional metadata companion. Stable
// contract tests inspect the serialized v1 object directly.
import {readFileSync} from 'node:fs';
import {readTrace, readTraceFile} from '../tools/dsl-trace.mjs';
export function readJSONFile(file, encoding = 'utf8') {
  return String(file).endsWith('.trace.json') ? readTraceFile(file) : JSON.parse(readFileSync(file,encoding));
}
export function readTraceMap(files, name) {
  const get = key => files instanceof Map ? files.get(key) : files[key];
  return readTrace(get(name),get(name.replace(/\.json$/,'.meta.json')));
}
