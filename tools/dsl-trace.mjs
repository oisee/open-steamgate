// Stable provenance and optional navigation metadata. The project root is supplied
// by the caller; it is deliberately absent from the serialized contract.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, relative, resolve} from 'node:path';
export const hashText = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
export const legacyTrace = () => process.env.OSD_TRACE_LEGACY === '1' || process.argv.includes('--trace-legacy');
export function traceArgs(args) { return args.filter(arg => arg !== '--trace-legacy'); }
const cmp = (a, b) => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};
// Keep JSON escaping and omission semantics, then lay out containers. Scalar
// arrays and flat objects include empty containers; nested containers stay multiline.
export function serializeJson(value) {
  const scalar = value => value === null || typeof value !== 'object';
  const render = (value, depth) => {
    const pad = '  '.repeat(depth), child = pad + '  ';
    if (Array.isArray(value)) {
      if (value.every(scalar)) return '[' + value.map(v => JSON.stringify(v)).join(', ') + ']';
      return '[\n' + value.map(v => child + render(v, depth + 1)).join(',\n') + '\n' + pad + ']';
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.every(([,v]) => scalar(v))) return '{' + entries.map(([k,v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(', ') + '}';
      return '{\n' + entries.map(([k,v]) => child + JSON.stringify(k) + ': ' + render(v, depth + 1)).join(',\n') + '\n' + pad + '}';
    }
    return JSON.stringify(value);
  };
  return render(JSON.parse(JSON.stringify(value)), 0) + '\n';
}
const json = serializeJson;
export function projectPath(file, root = process.cwd()) {
  if (!file) return '';
  return (isAbsolute(file) ? relative(root, file) : file).replaceAll('\\', '/');
}
const unique = (rows, keys) => [...new Map(rows.map(r => [JSON.stringify(keys.map(k => r[k])), r])).values()]
  .sort((a, b) => { for (const k of keys) { const d = typeof a[k] === 'number' ? a[k] - b[k] : cmp(a[k], b[k]); if (d) return d; } return 0; });
function integer(n) { if (!Number.isSafeInteger(n) || n < 0) throw new Error(`invalid trace integer ${n}`); return n; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => {
    if (a?.file !== undefined && b?.file !== undefined) {
      const file = cmp(a.file, b.file);
      if (file) return file;
      if (typeof a.line === 'number' && typeof b.line === 'number' && a.line !== b.line) return a.line - b.line;
    }
    return cmp(JSON.stringify(a), JSON.stringify(b));
  });
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(cmp).map(k => [k, canonical(value[k])]));
  if (typeof value === 'number') integer(value);
  return value;
}
export function expandLines(records) {
  const out = []; let last = 0;
  for (const r of [...records].sort((a,b) => (a.line ?? a.lines?.[0]) - (b.line ?? b.lines?.[0]))) {
    if (Object.hasOwn(r,'line') === Object.hasOwn(r,'lines')) throw new Error('trace record requires exactly one of line or lines');
    const [a,b] = r.lines ?? [r.line,r.line]; integer(a); integer(b);
    if (a < 1 || b < a || (r.lines && (r.lines.length !== 2 || a === b)) || a <= last) throw new Error('invalid or overlapping trace range');
    if (!Array.isArray(r.sources) || !Array.isArray(r.locations) || !r.locations.length) throw new Error('trace requires sources and locations');
    for (const l of r.locations) integer(l.offset);
    for (let n = a; n <= b; n++) out.push({line:n, sources:r.sources, locations:r.locations.map(l => ({...l, offset:l.offset+n-a}))});
    last = b;
  }
  return out;
}
export function stableTrace(outputs) {
  const seen = new Set();
  return {format:'osd-trace/1', outputs: outputs.map(output => {
    if (seen.has(output.file)) throw new Error('duplicate trace output'); seen.add(output.file);
    const records = expandLines(output.lines).map(r => ({line:r.line,
      sources:unique(r.sources.map(s => ({file:s.file,node:s.node,selector:s.selector})),['file','node','selector']),
      locations:unique(r.locations.map(l => ({recipe:l.recipe,anchor:l.anchor,offset:l.offset})),['recipe','anchor','offset'])}));
    const runs = [];
    for (const r of records) {
      const p = runs.at(-1), end = p?.lines?.[1] ?? p?.line;
      const advance = p && JSON.stringify(p.sources) === JSON.stringify(r.sources) && p.locations.length === r.locations.length && p.locations.every((l,i) => l.recipe === r.locations[i].recipe && l.anchor === r.locations[i].anchor && l.offset + r.line - (p.lines?.[0] ?? p.line) === r.locations[i].offset);
      if (advance && end + 1 === r.line && !output.boundaries?.has(r.line)) {
        if (p.line) { const a = p.line; delete p.line; runs[runs.length-1] = {lines:[a,r.line],sources:p.sources,locations:p.locations}; }
        else p.lines[1] = r.line;
      } else runs.push(r);
    }
    return {file:output.file, lines:runs};
  }).sort((a,b) => cmp(a.file,b.file))};
}
export function serializeTrace(trace) { return json(stableTrace(trace.outputs)); }
// Find the persistent node and a selector relative to it, never an array index
// above the node. Paths remain only in metadata.
export function sourceTuple(model, path, file, fallback) {
  let cur = model, node = cur?.['@id'] ?? fallback, depth = 0;
  const parts = String(path ?? '').split('/').filter(Boolean);
  parts.forEach((p,i) => { cur = Array.isArray(cur) ? cur[Number(p)-1] : cur?.[p]; if (cur?.['@id']) {node=cur['@id']; depth=i+1;} });
  return node ? {file, node, selector:'/' + parts.slice(depth).join('/')} : undefined;
}
function normalizePaths(value, root, key = '') {
  if (Array.isArray(value)) return value.map(v => normalizePaths(v,root,key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalizePaths(v,root,k)]));
  return typeof value === 'string' && (['file','rule','set','source','recipe','template','rule_file','model'].includes(key) || key.endsWith('_overlay') || key === 'overlay') && !value.startsWith('sha256:') ? projectPath(value,root) : value;
}
export function convertTrace(old, outputs, {model, root = process.cwd(), source, recipe, generator} = {}) {
  const legacy = Array.isArray(old) ? {lines:old} : old;
  const sourceFile = projectPath(source ?? legacy.rule ?? legacy.set ?? legacy.source ?? (typeof legacy.model === 'string' && !legacy.model.startsWith('sha256:') ? legacy.model : ''), root);
  const baseRecipe = projectPath(recipe ?? legacy.template ?? legacy.recipe ?? 'tools/dsl-trace.mjs', root);
  const hints = [], stable = [], templates = {};
  for (const [file,text] of Object.entries(outputs)) {
    const rows = legacy.objects?.[file] ?? legacy.lines ?? [];
    const byLine = new Map(rows.map(r => [r.line,r]));
    const count = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
    const counters = new Map(), lines = [], boundaries = new Set(); let previous;
    for (let i=0;i<count;i++) {
      const e = byLine.get(i+1) ?? {line:i+1};
      const contributors = e.contributors?.length ? e.contributors : [e];
      const sources = [], locations = [], used = new Set();
      for (const c of contributors) {
        const locationRecipe = c.recipe ?? (['dsl-mpc','dsl-dpc'].includes(legacy.generator) ? (legacy.generator === 'dsl-mpc' ? `src/dsl/mpc-templates/${c.template ?? legacy.template}.tpl` : `src/dsl/dpc-templates/${c.template === 'dpc_class' ? 'class' : c.template ?? 'class'}.tpl`) : (c.template && !['main','template.tpl'].includes(c.template) ? (c.template.includes('/') ? c.template : `${dirname(baseRecipe)}/${c.template}.tpl`) : baseRecipe));
        const tuple = c.source ?? sourceTuple(model,c.path,sourceFile,c.node ?? e.node);
        if (tuple) sources.push(tuple);
        const key = JSON.stringify([locationRecipe,tuple?.node ?? '',c.invocation ?? 0]);
        const last = counters.get(key);
        const offset = last ? last.line === i+1 ? last.offset : last.offset + 1 : 0;
        if (!used.has(key)) { counters.set(key,{line:i+1,offset}); used.add(key); }
        locations.push({recipe:projectPath(locationRecipe,root),anchor:'<partial>',offset});
        if (!(projectPath(locationRecipe,root) in templates) && existsSync(resolve(root,locationRecipe))) templates[projectPath(locationRecipe,root)] = hashText(readFileSync(resolve(root,locationRecipe),'utf8'));
      }
      for (const node of e.nodes ?? []) sources.push({file:sourceFile,node,selector:'/'});
      const identity = JSON.stringify([...used].sort(cmp));
      if (previous !== identity) boundaries.add(i+1); previous=identity;
      lines.push({line:i+1,sources:e.sources ?? sources,locations});
      hints.push({file,line:i+1,...e});

    }
    stable.push({file:projectPath(file,root),lines,boundaries});
  }
  const {lines,objects,...fields} = legacy;
  const declared = [baseRecipe,...Object.entries(fields).filter(([k])=>k.includes('overlay')).flatMap(([,v])=>Array.isArray(v)?v:[v])];
  for (const file of declared) if (typeof file === 'string' && existsSync(resolve(root,file))) templates[projectPath(file,root)] = hashText(readFileSync(resolve(root,file),'utf8'));
  const meta = canonical(normalizePaths({format:'osd-trace-meta/1',...fields,
    generator:legacy.generator ?? generator ?? 'dsl', generator_version:'0.7',
    ...(typeof legacy.model === 'string' && legacy.model.startsWith('sha256:') ? {} : model ? {model_hash:hashText(JSON.stringify(model))} : {}),model_serialization:'JSON.stringify (existing writer model)', outputs:Object.entries(outputs).map(([file,text]) => ({file:projectPath(file,root),hash:hashText(text)})),templates,lines:hints},root));
  return {trace:json(stableTrace(stable)),meta:json(meta)};
}
export function convertFiles(files, options = {}) {
  if (legacyTrace()) return files;
  const result = {...files};
  for (const [name,text] of Object.entries(files)) {
    if (!name.endsWith('.trace.json')) continue;
    const old = JSON.parse(text); if (old.format) continue;
    const output = name.slice(0,-'.trace.json'.length);
    const outputs = old.objects ? Object.fromEntries(Object.keys(old.objects).map(f => [f, files[f] ?? options.objects?.[f]])) : {[output in files ? output : `${output}.abap`]:files[output] ?? files[`${output}.abap`]};
    if (Object.values(outputs).some(v => v === undefined)) throw new Error(`no output for ${name}`);
    const pair = convertTrace(old,outputs,options);
    result[name] = pair.trace; result[name.replace(/\.json$/,'.meta.json')] = pair.meta;
  }
  return result;
}
export function readTrace(trace, meta, outputs) {
  if (typeof trace === 'string') trace = JSON.parse(trace);
  if (!trace.format) return Array.isArray(trace) ? {lines:trace} : trace;
  if (trace.format !== 'osd-trace/1') throw new Error(`unsupported trace format ${trace.format}`);
  if (typeof meta === 'string') meta = JSON.parse(meta);
  if (meta && meta.format !== 'osd-trace-meta/1') throw new Error('unsupported trace metadata format');
  if (meta && outputs) for (const o of meta.outputs) if (outputs[o.file] === undefined || hashText(outputs[o.file]) !== o.hash) throw new Error(`trace metadata output hash mismatch: ${o.file}`);
  const normalized = stableTrace(trace.outputs);
  const hints = new Map(meta?.lines?.map(h => [`${h.file}:${h.line}`,h]) ?? []);
  const lines = normalized.outputs.flatMap(o => expandLines(o.lines).map(r => {
    const hint = hints.get(`${o.file}:${r.line}`) ?? {};
    return {...hint,...r,file:o.file,node:hint.node ?? r.sources[0]?.node};
  }));
  return {...meta,format:trace.format,outputs:normalized.outputs,lines};
}
export function readTraceFile(file, {root = process.cwd(), navigation = true} = {}) {
  const metaFile = file.replace(/\.json$/,'.meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile,'utf8')) : undefined;
  const trace = JSON.parse(readFileSync(file,'utf8'));
  let outputs;
  if (meta && navigation) outputs = Object.fromEntries(meta.outputs.map(o => {
    const local = resolve(dirname(file),basename(o.file));
    const path = existsSync(resolve(root,o.file)) ? resolve(root,o.file) : local;
    return [o.file, readFileSync(path,'utf8')];
  }));
  return readTrace(trace,meta,outputs);
}

// The CLI compatibility switch also applies to the native GenerateSet writer.
export function legacyFiles(files) {
  const result={...files};
  for (const [file,text] of Object.entries(files)) if (file.endsWith('.trace.json')) {
    const stable=JSON.parse(text); if (stable.format!=='osd-trace/1') continue;
    const metaName=file.replace(/\.json$/,'.meta.json');
    if (!files[metaName]) throw new Error(`legacy conversion requires ${metaName}`);
    const meta=JSON.parse(files[metaName]);
    const {format,outputs,templates,model_serialization,generator_version,...old}=meta;
    old.lines=old.lines.map(({file,template,...line})=>line).sort((a,b)=>a.line-b.line);
    result[file]=JSON.stringify(old,null,2)+'\n'; delete result[metaName];
  }
  return result;
}

// Sub-renderers (ports and adapters) have a smaller model than the enclosing
// set. Resolve their source tuples before that context is lost in the file map.
export function enrichTrace(model, trace, file = model.source) {
  if (legacyTrace()) return trace;
  return trace.map(e => ({...e, contributors:(e.contributors?.length?e.contributors:[e]).map(c => ({...c,
    source:sourceTuple(model,c.path,projectPath(file),c.node ?? e.node),
  }))}));
}

export function legacyEntries(trace) {
  return trace.map(({contributors,recipe,source,...entry}) => entry);
}
