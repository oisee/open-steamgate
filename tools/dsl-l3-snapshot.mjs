// Opt-in input identities. Recipes remain byte-stable for sets without snapshots.
import {readFileSync} from 'node:fs';
export function compileSnapshots(doc, model, {line, fail, columnsOf}) {
  const map = doc.snapshots;
  if (map === undefined) {
    if (doc.input !== undefined) fail(line('input'), 'input names a declared snapshot');
    for (const [i, s] of (doc.stages ?? []).entries()) if (s.input !== undefined) fail(line(`stages/${i}/input`), 'input names a declared snapshot');
    return;
  }
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.keys(map).length) fail(line('snapshots'), 'snapshots is a nonempty mapping');
  model.snapshots = Object.entries(map).map(([name, spec]) => {
    const base = `snapshots/${name}`;
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(name)) fail(line(base), 'snapshot name is at most 16 lower-case letters, digits or underscores');
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail(line(base), 'snapshot is {source, key, fields, canonical}');
    for (const k of Object.keys(spec)) if (!['source', 'key', 'fields', 'canonical'].includes(k)) fail(line(`${base}/${k}`), `unknown snapshot key ${k}`);
    const port = model.ports.find((p) => p.name === spec.source);
    if (port && !port.is_source) fail(line(`${base}/source`), 'snapshot source must be a source port or table');
    if (typeof spec.source !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(spec.source)) fail(line(`${base}/source`), 'snapshot source must be a source port or table');
    const table = port?.table ?? spec.source.toLowerCase();
    const cols = columnsOf(table, base);
    const list = (value, key) => {
      if (!Array.isArray(value) || !value.length) fail(line(`${base}/${key}`), `${key} is a nonempty field list`);
      const names = value.map((v, i) => {
        if (typeof v !== 'string' || !cols.names.includes(v.toLowerCase()) || v.toLowerCase() === cols.client) fail(line(`${base}/${key}/${i}`), `unknown or client field ${v}`);
        return v.toLowerCase();
      });
      if (new Set(names).size !== names.length) fail(line(`${base}/${key}`), `duplicate ${key} field`);
      return names;
    };
    const keys = list(spec.key, 'key');
    const fields = list(spec.fields ?? cols.names.filter((n) => n !== cols.client), 'fields');
    if (spec.canonical !== 'sorted-by-key') fail(line(`${base}/canonical`), 'canonical must be sorted-by-key');
    // Only stable external scalar forms are accepted by this slice.
    for (const n of new Set([...keys, ...fields])) {
      const f = cols.fields.find((f) => f.FIELDNAME.toLowerCase() === n);
      if (!['CHAR', 'NUMC', 'DATS', 'TIMS', 'INT1', 'INT2', 'INT4', 'DEC', 'CURR', 'QUAN', 'CLNT', 'LANG', 'CUKY', 'UNIT'].includes(f.DATATYPE)) fail(line(base), `snapshot field ${n} has unsupported external type ${f.DATATYPE}`);
    }
    return {'@id': `${model['@id']}/snapshot/${name}`, set_line: line(base), name, "name@type": {built_in: "CHAR", length: 16}, table,
      ...(port ? {port: port.name, "port@type": {built_in: "CHAR", length: 12}, iface: port.iface} : {}),
      order: keys.join(' '), keys: keys.map((field) => ({name: field, row: name})), fields: fields.map((field) => ({name: field, row: name}))};
  });
  const input = (name, at, stage) => {
    if (!model.snapshots.some((s) => s.name === name)) fail(line(at), `input ${JSON.stringify(name)} names no snapshot`);
    return {name, "name@type": {built_in: "CHAR", length: 16}, stage};
  };
  model.snapshot_identity = {'@id': `${model['@id']}/snapshots`, set_line: line('snapshots')};
  model.snapshot_inputs = [];
  if (doc.input !== undefined) model.snapshot_inputs.push(input(doc.input, 'input', '0'));
  for (const [i, s] of (doc.stages ?? []).entries()) if (s.input !== undefined) model.snapshot_inputs.push(input(s.input, `stages/${i}/input`, String(i + 1)));
}
export function snapshotOverlay(model, text, observe) {
  let previous=text;
  const record=(recipe="tools/dsl-l3-snapshot.mjs")=>{observe?.(previous,text,recipe);previous=text;};
  if (!model.snapshots) return text;
  text = text.replace('  PUBLIC SECTION.\n', '  PUBLIC SECTION.\n' + readFileSync('recipes/l3-snapshot/public.tpl', 'utf8'));
  record("recipes/l3-snapshot/public.tpl");
  if (model.resilience && !model.settings) {
    text = text.replace('  PRIVATE SECTION.\n', '  PRIVATE SECTION.\n    CLASS-DATA gv_snapshot_dry TYPE abap_bool.\n');
    const dry = '{{#settings}}\n    gv_dry = abap_true.\n{{/settings}}';
    if (!text.includes(dry)) throw new Error('snapshot recipe needs dry-run anchor');
    text = text.replace(dry, dry + '\n    gv_snapshot_dry = abap_true.');
    text = text.replace('    DATA lx_error TYPE REF TO cx_root.\n', '    DATA lx_error TYPE REF TO cx_root.\n    DATA lv_snapshot_dry TYPE abap_bool.\n');
    text = text.replace('    IF iv_mode = c_parallel.\n', '    lv_snapshot_dry = gv_snapshot_dry.\n    CLEAR gv_snapshot_dry.\n    IF iv_mode = c_parallel.\n');
  }
  // Capture the installed source once, inside the existing swap/restore fence.
  const anchor = '{{/sources}}\n{{^planned}}';
  if (!text.includes(anchor)) throw new Error('snapshot recipe needs installed-source anchor');
  const settings = '{{#settings}}\n    IF lv_dry = abap_false.\n      {{settings.class}}=>snapshot( iv_run = rs_result-run_id is_state = gs_settings ).\n    ENDIF.\n{{/settings}}\n';
  text = text.replace(settings, '');
  record();
  text = text.replace(anchor, '{{/sources}}\n' + readFileSync('recipes/l3-snapshot/run.tpl', 'utf8') + settings.replace(/^    /gm, '        ') + '{{^planned}}');
  record("recipes/l3-snapshot/run.tpl");
  text = text.replace(/ENDCLASS\.\s*$/, readFileSync('recipes/l3-snapshot/methods.tpl', 'utf8') + 'ENDCLASS.\n');
  record("recipes/l3-snapshot/methods.tpl");
  return text;
}
