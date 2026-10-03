// DSL L3: stages, filter stages with a worklist, and a schedule
// (docs/dsl-l3.md, "Stages, filters and a schedule"). A set's `stages:` is an
// ordered list; stage n+1 opens only when every pile of stage n is DONE. A
// filter stage's rules (L2 `keys: true`) fill a worklist instead of the alert
// log, and a later stage piles over that worklist through the source port of
// its key (the generated `worklist` variant). `schedule:` runs the set as a
// periodic background job. tools/dsl-l3.mjs calls these; they know the set
// language, nothing of any domain.

export const STAGE_KEYS = ["stage", "filter", "worklist", "piles", "rules", "input"];
export const STAGE_NAME = /^[a-z][a-z0-9_]{0,12}$/;
export const MAX_STAGES = 9;
// the worklist table and the gate table, generic for every set
export const WORK_TABLE = "ZOSD_L3_WORK";
export const STAGE_TABLE = "ZOSD_L3_STAGE";
// the generated source variant a stage piles over a worklist with
export const WORKLIST_VARIANT = "worklist";
const WORKLIST_SOURCE = /^worklist:([a-z][a-z0-9_]{0,12})$/;
const CHAR = (length) => ({built_in: "CHAR", length});
const INT4 = {built_in: "INT4"};

// The stages as written, before any rule is compiled: their names, flags and
// the rule entries each lists, with the manifest path of every entry.
export function readStages(doc, {line, fail}) {
  for (const key of ["rules", "piles"]) {
    if (doc[key] !== undefined && !(key === "piles" && typeof doc.piles === "object" && !Array.isArray(doc.piles) && Object.keys(doc.piles).every((k) => ["release", "lanes"].includes(k)))) fail(line(key), `${key}: and stages: do not go together; with stages: every stage lists its own rules and piles`);
  }
  if (!Array.isArray(doc.stages) || !doc.stages.length) fail(line("stages"), "stages is a list of {stage, filter, worklist, piles, rules}");
  if (doc.stages.length > MAX_STAGES) fail(line("stages"), `a set has at most ${MAX_STAGES} stages (the stage is one digit of the job names L3_<SET>_<s><nn>)`);
  const names = new Map();
  return doc.stages.map((spec, s) => {
    const base = `stages/${s}`;
    const at = line(base);
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(at, "a stage is a mapping with stage and rules");
    for (const key of Object.keys(spec)) if (!STAGE_KEYS.includes(key)) fail(line(`${base}/${key}`), `unknown key ${key} in a stage (${STAGE_KEYS.join(", ")})`);
    const name = spec.stage;
    if (typeof name !== "string" || !STAGE_NAME.test(name)) fail(at, `stage ${JSON.stringify(name)} is a lower-case name of 1 to 13 letters, digits and _ starting with a letter`);
    if (names.has(name)) fail(at, `stage ${name} is already in the set at line ${names.get(name)}`);
    names.set(name, at);
    const filter = spec.filter ?? "false";
    if (filter !== "true" && filter !== "false") fail(line(`${base}/filter`), `filter is true or false, not ${JSON.stringify(filter)}`);
    if (!Array.isArray(spec.rules) || !spec.rules.length) fail(line(spec.rules === undefined ? base : `${base}/rules`), `stage ${name} is empty: a stage runs at least one rule`);
    return {s, name, at, base, filter: filter === "true", worklist: spec.worklist, piles: spec.piles,
      entries: spec.rules.map((entry, i) => ({entry, path: `${base}/rules/${i}`}))};
  });
}

// The stages against the compiled rules and the ports: which rules each runs,
// the worklist a filter stage fills and the one a stage piles over, the source
// and size of a piled stage, and the worklist variant each port needs. `rules`
// holds every compiled entry with its stage index `s`.
export function compileStages(stages, rules, {id, set, ports, line, fail, columnsOf, asMap}) {
  const SET = set.toUpperCase();
  const worklists = new Map(); // name -> {stage, table, field, port}
  const out = stages.map((stage) => {
    const {s, name, base} = stage;
    const enabled = rules.filter((r) => r.s === s && r.enabled);
    if (!enabled.length) fail(stage.at, `stage ${name} is empty: every rule of it is disabled`);
    const node = {"@id": `${id}/stage/${name}`, set_line: stage.at, no: String(s + 1), "no@type": INT4, name, "name@type": CHAR(16)};
    // a filter stage: every rule hands back its keys, all over one key, into one worklist
    if (stage.filter) {
      for (const r of enabled) {
        if (!r.compiled.driving_keys) fail(r.at, `rule ${r.compiled.rule} is in filter stage ${name} and has no keys: true; a filter stage fills its worklist from keys( )`);
      }
      const [first] = enabled;
      const key = first.compiled.range;
      const other = enabled.find((r) => r.compiled.range.table !== key.table || r.compiled.range.field !== key.field);
      if (other) fail(other.at, `rule ${other.compiled.rule} hands back keys of ${other.compiled.range.table.toUpperCase()}-${other.compiled.range.field.toUpperCase()}, the other rules of stage ${name} keys of ${key.table.toUpperCase()}-${key.field.toUpperCase()}; a worklist holds one key`);
      if (typeof stage.worklist !== "string" || !STAGE_NAME.test(stage.worklist)) fail(line(stage.worklist === undefined ? base : `${base}/worklist`), `filter stage ${name} names the worklist it fills (worklist: <name>, a lower-case name of 1 to 13 characters)`);
      if (worklists.has(stage.worklist)) fail(line(`${base}/worklist`), `worklist ${stage.worklist} is filled twice: by stage ${worklists.get(stage.worklist).stage} and by stage ${name}`);
      // a worklist key is compared as text (KEY_VALUE BETWEEN a pile's bounds), and the plan
      // sorts it in its own type: the two agree only for a key that sorts as text
      const kind = key.type?.built_in;
      if (!["CHAR", "NUMC", "DATS"].includes(kind)) fail(line(stage.worklist === undefined ? base : `${base}/worklist`), `the worklist ${stage.worklist ?? ""} would hold keys of ${key.table.toUpperCase()}-${key.field.toUpperCase()}, a ${kind ?? "type not known"}; a worklist key is compared as text, so it is CHAR, NUMC or DATS, which sort as text`);
      const port = ports.find((p) => p.is_source && p.table === key.table && p.key === key.field);
      if (!port) fail(line(`${base}/worklist`), `worklist ${stage.worklist} holds keys of ${key.table.toUpperCase()}-${key.field.toUpperCase()}; a later stage reads it through a source port of that table and key, and the set has none`);
      const field = columnsOf(key.table, `ports/${port.name}`).fields.find((f) => f.FIELDNAME.toLowerCase() === key.field);
      if (Number(field.LENG) > 40) fail(line(`${base}/worklist`), `the key ${key.table.toUpperCase()}-${key.field.toUpperCase()} is longer than 40 characters, the width of ${WORK_TABLE}-KEY_VALUE`);
      worklists.set(stage.worklist, {stage: name, table: key.table, field: key.field, port});
      node.filter = true;
      node.worklist = {"@id": `${id}/stage/${name}/worklist`, set_line: line(`${base}/worklist`), name: stage.worklist, "name@type": CHAR(16)};
    } else if (stage.worklist !== undefined) {
      fail(line(`${base}/worklist`), `stage ${name} is not a filter (filter: true) and fills no worklist`);
    }
    // a piled stage: the keys of a source port, or of a worklist an earlier stage filled
    if (stage.piles !== undefined) {
      const at = `${base}/piles`;
      const spec = asMap(stage.piles, at, "a mapping with source and size");
      for (const key of Object.keys(spec)) if (!["source", "size"].includes(key)) fail(line(`${at}/${key}`), `unknown key ${key} in piles (source, size)`);
      if (!/^[1-9][0-9]{0,9}$/.test(String(spec.size)) || Number(spec.size) > 2147483647) fail(line(`${at}/size`), `piles.size is a whole number from 1 to 2147483647 (an INT4), not ${JSON.stringify(spec.size)}`);
      const from = WORKLIST_SOURCE.exec(String(spec.source ?? ""));
      let port, worklist;
      if (from) {
        worklist = worklists.get(from[1]);
        if (!worklist) fail(line(`${at}/source`), `worklist ${from[1]} is used before it is filled: no filter stage before stage ${name} fills it`);
        port = worklist.port;
        // over a worklist every rule is piled: one that is not would run over every row and pass the filter by
        const off = enabled.find((r) => r.compiled.range?.table !== port.table || r.compiled.range.field !== port.key);
        if (off) fail(off.at, `rule ${off.compiled.rule} has ${off.compiled.range ? `range: ${off.compiled.range.alias}.${off.compiled.range.field} of ${off.compiled.range.table.toUpperCase()}` : "no range:"}; stage ${name} piles over worklist ${from[1]}, keys of ${port.table.toUpperCase()}-${port.key.toUpperCase()}, and a rule there has that range: field`);
      } else {
        port = ports.find((p) => p.name === spec.source && p.is_source);
        if (!port) fail(line(`${at}/source`), `piles.source ${JSON.stringify(spec.source)} is neither a source port of the set (${ports.filter((p) => p.is_source).map((p) => p.name).join(", ") || "none"}) nor worklist:<name>`);
        const field = columnsOf(port.table, `ports/${port.name}`).fields.find((f) => f.FIELDNAME.toLowerCase() === port.key);
        if (Number(field.LENG) > 40) fail(line(`${at}/source`), `the key ${port.table.toUpperCase()}-${port.key.toUpperCase()} is longer than 40 characters, the width of ZOSD_L3_PILE-RANGE_LOW and RANGE_HIGH`);
        if (!enabled.some((r) => r.compiled.range?.table === port.table && r.compiled.range.field === port.key)) {
          fail(line(at), `no rule of stage ${name} is piled: a rule is piled when its range: is ${port.key} of ${port.table.toUpperCase()}, the key of port ${port.name}`);
        }
      }
      node.piles = {"@id": `${id}/stage/${name}/piles`, set_line: line(at), size: String(spec.size), "size@type": INT4,
        source: {name: port.name, "name@type": CHAR(30), table: port.table, key: port.key, iface: port.iface},
        ...(worklist ? {over_worklist: {"@id": `${id}/stage/${name}/piles/worklist`, set_line: line(`${at}/source`), name: from[1], "name@type": CHAR(16), class: `zcl_l3_${set}_${port.name}_${WORKLIST_VARIANT}`}} : {})};
    }
    if (`L3_${SET}_${s + 1}99_9999`.length > 32) fail(stage.at, `the job names L3_<SET>_<s><nn>_<pppp> have at most 32 characters`);
    return node;
  });
  out.forEach((node, i) => { if (out[i + 1]) node.next = out[i + 1].no; else node.last = true; });
  return {stages: out, worklists};
}

// A port a worklist is read through gets the generated `worklist` variant:
// read( ) returns the port table's rows whose key is in the run's worklist.
export function worklistVariants(ports, worklists, {id, set, fail, line}) {
  for (const [name, {port}] of worklists) {
    const target = ports.find((p) => p.name === port.name);
    if (target.variants.some((v) => v.name === WORKLIST_VARIANT)) {
      if (target.variants.some((v) => v.name === WORKLIST_VARIANT && !v.generated)) fail(line(`ports/${port.name}/variants/${WORKLIST_VARIANT}`), `variant ${WORKLIST_VARIANT} of port ${port.name} is generated for worklist ${name}; name the hand-written class otherwise`);
      continue;
    }
    const className = `zcl_l3_${set}_${port.name}_${WORKLIST_VARIANT}`;
    if (className.length > 30) fail(line(`ports/${port.name}`), `the generated name ${className} has ${className.length} characters, a class name has at most 30; shorten the set or port name`);
    target.variants.push({"@id": `${id}/port/${port.name}/variant/${WORKLIST_VARIANT}`, set_line: target.set_line,
      name: WORKLIST_VARIANT, "name@type": CHAR(30), class: className, generated: true, is_worklist: true,
      port: port.name, "port@type": CHAR(30), hand: false, volatile: false, nonlive: false, planner: true});
    target.has_worklist = true;
  }
}

// `schedule: {every: <n><m|h|d|w>, at: HHMMSS}`: a periodic job in system time.
// Months are refused: JOB_CLOSE's PRDMONTHS is refused by the job facade
// (calendar months need end-of-month rules nobody has measured).
const UNITS = {m: {field: "prdmins", width: 2, word: "minutes"}, h: {field: "prdhours", width: 2, word: "hours"},
  d: {field: "prddays", width: 3, word: "days"}, w: {field: "prdweeks", width: 2, word: "weeks"}};
export function compileSchedule(doc, {id, set, line, fail, staged}) {
  if (doc.schedule === undefined) return undefined;
  const spec = doc.schedule;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(line("schedule"), "schedule is {every: <n><m|h|d|w>, at: HHMMSS}");
  for (const key of Object.keys(spec)) if (!["every", "at"].includes(key)) fail(line(`schedule/${key}`), `unknown key ${key} in schedule (every, at)`);
  if (!staged) fail(line("schedule"), "a schedule runs the set in jobs (mode P), and only a set with stages: completes in its jobs (the job that ends the last stage finalises and releases the run); give the set stages:");
  const every = /^([1-9][0-9]{0,2})([mhdw])$/.exec(String(spec.every ?? ""));
  if (!every) fail(line(spec.every === undefined ? "schedule" : "schedule/every"), `schedule.every is <n><unit>, the unit m (minutes), h (hours), d (days) or w (weeks); months are refused (the job facade refuses PRDMONTHS), not ${JSON.stringify(spec.every)}`);
  const unit = UNITS[every[2]];
  if (every[1].length > unit.width) fail(line("schedule/every"), `schedule.every ${spec.every}: a period in ${unit.word} has at most ${unit.width} digits (JOB_CLOSE ${unit.field.toUpperCase()})`);
  if (spec.at !== undefined) {
    const at = /^([01][0-9]|2[0-3])([0-5][0-9])([0-5][0-9])$/.exec(String(spec.at));
    if (!at) fail(line("schedule/at"), `schedule.at is the first start as HHMMSS in system time (UTC), not ${JSON.stringify(spec.at)}`);
  }
  return {"@id": `${id}/schedule`, set_line: line("schedule"), every: spec.every, count: every[1], field: unit.field,
    driver: `L3_${set.toUpperCase()}_D`, "driver@type": CHAR(32),
    ...(spec.at !== undefined ? {at: spec.at, "at@type": {built_in: "TIMS", length: 6}} : {})};
}

// explain's lines for an alert of a staged set: the stage of its rule, and its pile
export function explainStage(model, entry, k, at, row) {
  const stage = model.stages.find((s) => s.no === entry.stage_no);
  const piles = stage.piles;
  const over = piles ? (piles.over_worklist ? `piled over worklist ${piles.over_worklist.name}` : `piled over port ${piles.source.name}`) : "not piled";
  const range = row ? `, range ${String(row.range_low).trim() === String(row.range_high).trim() ? `I EQ ${String(row.range_low).trim()}`
    : `${piles?.over_worklist ? "the worklist's keys from" : "I BT"} ${String(row.range_low).trim()} ${String(row.range_high).trim()}`}, ${String(row.status).trim()}` : "";
  return [`stage   ${stage.no} ${stage.name}${stage.filter ? `, a filter filling worklist ${stage.worklist.name}` : ""}, ${over} (${at(stage.set_line)})`,
    entry.piled ? `pile    ${k.pile} of the stage's plan, ${piles.size} keys of ${piles.source.key} per pile (${at(piles.set_line)})${range}`
      : `pile    ${k.pile}: the rule is not piled, one pile over every row (${at(stage.set_line)})`];
}
