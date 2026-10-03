// Model and action-to-runner contract, independent of any particular set.
import {readFileSync} from "node:fs";
import {cockpitUi, words} from "./dsl-l3-cockpit-ui.mjs";
const pascal = (s) => s.toLowerCase().split("_").map((p) => p[0].toUpperCase() + p.slice(1)).join("");
const tag = (s, n) => s.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1];
const visible = {
  Run: ["RunId", "CheckDate", "Status", "Started"], Stage: ["StageNo", "StageName", "Status", "Opened", "Ended"],
  Pile: ["RuleName", "PileNo", "Status", "Attempt", "Reason", "Alerts", "Started", "Ended"],
  Budget: ["Reserved", "Consumed", "Refunded", "Glass", "State", "WarnAt", "NarrowAt", "PerPile"],
  Event: ["Seq", "Kind", "Acted", "Reason", "Actor", "Reserved", "Consumed", "Refunded", "Glass"],
  Doctor: ["Seq", "DocAction", "Reason", "Acted", "RuleName", "PileNo"],
  Snapshot: ["ParamName", "ParamVal", "DslValue", "Origin", "ChangedBy", "ChangedAt"],
};
export function cockpitActions(m) {
  const actions = [
    {name: "StartRun", method: "run", params: {CheckDate: "String(8)", Mode: "String(1)"}, run: true,
      call: `ls_run = ${m.class}=>run( iv_date = lv_date iv_mode = lv_mode ).\n        ls_answer-run_id = ls_run-run_id.\n        ls_answer-answer = ls_run-status.\n        IF ls_run-status = 'SUBMITTED'.\n          ls_answer-answer = ls_answer-answer && ': background jobs carry the piles (on open-steamgate they need node tools/osd-batch-runs.mjs worker)'.\n          WRITE '@KERNEL if (typeof process !== "undefined" && process.env.OSD_JOB_WORKER === "extension") ls_answer.get().answer.set("SUBMITTED: background jobs carry the piles (OSD extension worker)");'.\n        ENDIF.`},
  ];
  if (m.simulate) {
    actions[0].params.Work = "String(4)";
    // 5d uses the existing binding argument, not a separate work argument.
    actions[0].call = `IF lv_work IS NOT INITIAL.\n          lv_work = |work={ lv_work }|.\n        ENDIF.\n        ` + actions[0].call.replace("iv_mode = lv_mode", "iv_mode = lv_mode iv_bind = lv_work");
  }
  // the runner answers abap_false without an exception when it declines; the operator gets words, not a blank
  const boolean = (name, method, params, args, reason = false, refused = "the runner declined it", why = "") => actions.push({name, method, params, reason,
    call: `${why ? `CLEAR ${why}.\n        ` : ""}lv_ok = ${m.class}=>${method}( ${args} ).\n        IF lv_ok = abap_true.\n          ls_answer-answer = 'OK'.\n        ELSE.\n          ls_answer-answer = 'REFUSED: ${name}: ${refused}'.${why ? `\n          IF ${why} IS NOT INITIAL.\n            ls_answer-answer = ls_answer-answer && ' (' && ${why} && ')'.\n          ENDIF.` : ""}\n        ENDIF.`});
  if (m.governor) {
    boolean("ReleasePile", "release_pile", {RunId: "String(32)", RuleName: "String(60)", PileNo: "Int32", PerPile: "Int32", Reason: "String(80)"},
      "iv_run = lv_run iv_rule = lv_rule iv_pile = lv_pile iv_per_pile = lv_cap iv_reason = lv_reason", true, "the pile is not HELD, the run or its budget does not allow a release (GLASS, not open), the per-pile cap is lowered, the pile is locked, or the reason is empty or over 80 characters");
    boolean("ContinueGlass", "continue_glass", {RunId: "String(32)", NewGlass: "Int32", Reason: "String(80)"},
      "iv_run = lv_run iv_new_glass = lv_glass iv_reason = lv_reason", true, "the run is not at GLASS, the new glass is not above the current one, or the reason is empty or over 80 characters");
  }
  if (m.resilience) for (const [name, method, params, args] of [["Resume", "resume", {RunId: "String(32)"}, "iv_run = lv_run"], ["Doctor", "doctor", {}, ""]]) {
    // with release by event the Doctor action also asks for a pass job: a release commits its claims
    // before it raises, and a commit belongs to a job, not to a service call
    const pass = name === "Doctor" && m.release_event && m.daemon ? `\n        \" the release: a pass job of its own (it commits its claims before it raises)\n        ${m.class}=>watcher_pass( ).` : "";
    actions.push({name, method, params, call: `lt_report = ${m.class}=>${method}( ${args} ).${pass}\n        LOOP AT lt_report INTO ls_report.\n          ls_answer-answer = ls_answer-answer && ls_report-doc_action && ':' && ls_report-reason && cl_abap_char_utilities=>newline.\n        ENDLOOP.`});
  }
  if (m.daemon) {
    boolean("StartDaemon", "start_daemon", {}, "");
    boolean("StopDaemon", "stop_daemon", {}, "");
  }
  if (m.killable) {
    boolean("SetKill", "set_kill", {Reason: "String(80)"}, "iv_reason = lv_reason", true, "the reason is empty or over 80 characters");
    boolean("ClearKill", "clear_kill", {Reason: "String(80)"}, "iv_reason = lv_reason", true, "the reason is empty or over 80 characters");
  }
  if (m.settings) {
    boolean("SetSetting", "set_setting", {Param: "String(30)", Value: "String(40)", Note: "String(80)"}, "iv_param = lv_param iv_value = lv_value iv_note = lv_note", true,
      `unknown setting, a value outside its range, budget.warn above budget.narrow_at, ${m.settings.chaos_sum ? "simulate dump + hang + slow above 1000, " : ""}or the note is empty or over 80 characters`, m.settings.has_list ? `${m.settings.class}=>refusal` : "");
    boolean("ResetSetting", "cockpit_reset_setting", {Param: "String(30)", Note: "String(80)"}, "iv_param = lv_param iv_note = lv_note", true, "unknown setting, or the note is empty or over 80 characters");
  }
  if (m.schedule) {
    actions.push({name: "Schedule", method: "schedule", params: {}, call: `ls_answer-answer = ${m.class}=>schedule( ).`});
    // unschedule( ) answers a structure; a system refuses it as the answer string
    // (this runtime converted it silently), so the cockpit words it
    actions.push({name: "Unschedule", method: "unschedule", params: {}, call: `ls_unschedule = ${m.class}=>unschedule( ).\n        ls_answer-answer = |deleted { ls_unschedule-deleted }, refused { ls_unschedule-refused }|.`});
    actions.push({name: "ScheduleStatus", method: "cockpit_schedule_status", params: {}, get: true,
      call: `ls_answer-answer = ${m.class}=>cockpit_schedule_status( ).${m.daemon ? `\n        ls_answer-answer = ls_answer-answer && ' / ' && ${m.class}=>daemon_status( ).` : ""}${m.release_event ? `\n        ls_answer-answer = ls_answer-answer && \` / \` && ${m.class}=>lanes_status( ).` : ""}`});
  }
  return actions;
}
export function cockpitService(m, {tableSource = (table) => readFileSync(`src/dsl/${table}.tabl.xml`, "utf8")} = {}) {
  const c = m.cockpit, entities = [], doc = {project: c.project, service: c.service, description: c.title,
    entities: {}, functions: {}, associations: {}, annotations: {}};
  const tables = [["Run", "run"], ["Stage", "stage"], ["Pile", "pile"]];
  if (m.governor) tables.push(["Budget", "budget"], ["Event", "event"]);
  if (m.resilience) tables.push(["Doctor", "doctor"]);
  if (m.autodoctor) tables.push(["RunStat", "runstat"]);
  if (m.settings) tables.push(["Setting", "conf"], ["Change", "conf_log"], ["Snapshot", "run_conf"]);
  for (const [name, suffix] of tables) {
    const table = `zosd_l3_${suffix}`, xml = tableSource(table);
    let fields = [...xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)].map((x) => x[1]).filter((x) => tag(x, "FIELDNAME") !== "MANDT");
    if (!m.snapshots) fields = fields.filter((f) => !/^(EXPECTED_|STORED_)/.test(tag(f, "FIELDNAME"))
      && !(suffix === "run_conf" && ["SNAP_ID", "CONTENT_HASH", "ROW_COUNT"].includes(tag(f, "FIELDNAME"))));
    const keys = [], properties = {}, columns = [];
    for (const field of fields) {
      const raw = tag(field, "FIELDNAME"), prop = pascal(raw), type = tag(field, "DATATYPE"), len = raw === "DOC_ACTION" && !m.snapshots ? 12 : +tag(field, "LENG");
      const timestamp = type === "DEC" && len === 15 && ["STARTED", "ENDED", "OPENED", "ACTED", "CHANGED_AT", "UPDATED_AT"].includes(raw);
      const edm = timestamp || type === "DATS" ? "DateTime" : /^INT/.test(type) ? "Int32" : type === "DEC" ? `Decimal(${len},${+tag(field, "DECIMALS") || 0})` : type === "STRG" ? "String" : `String(${len})`;
      properties[prop] = {type: edm, field: raw, label: prop, readonly: true};
      columns.push({field: raw.toLowerCase(), property: prop});
      if (tag(field, "KEYFLAG") === "X") keys.push({field: raw.toLowerCase(), property: prop});
    }
    // Historical stage plans survive the date lock's next run. RunId is the
    // UI identity; the extension folds those plans into the run table's rows.
    if (name === "Run") keys.splice(0, keys.length, {field: "run_id", property: "RunId"});
    keys[keys.length - 1].last = true;
    doc.entities[name] = {set: `${name}Set`, source: {table: table.toUpperCase()}, keys: keys.map((k) => k.property), properties,
      creatable: false, updatable: false, deletable: false, operations: ["R", "Q"]};
    const shown = visible[name] ? [...visible[name]] : columns.map((f) => f.property).filter((p) => p !== "SetName");
    if (name === "Stage" && properties.RunBind) shown.push("RunBind");
    const lineItem = shown
      .map((property) => ({value: property, label: property.replace(/([a-z])([A-Z])/g, "$1 $2")}));
    doc.annotations[name] = {lineItem};
    const order = {Stage: "stage_no", Pile: "stage_no rule_name pile_no", Event: "seq", Doctor: "acted seq", Change: "changed_at DESCENDING", Snapshot: "param_name", Setting: "param_name"}[name];
    entities.push({name, table, method: `${name.toLowerCase()}set`, keys, run: name === "Run", columns, order,
      has_run: columns.some((f) => f.property === "RunId"), setting: name === "Setting"});
    if (!["Run", "Setting", "Change"].includes(name)) doc.associations[`RunTo${name}`] = {from: "Run", to: name,
      cardinality: "1:N", constraint: {RunId: "RunId"}, navigation: {Run: `to_${name}`}};
  }
  if (m.remote) doc.entities.Run.properties.RemoteRun = {type: "String(32)", field: "REMOTE_RUN", label: "Receiving run", readonly: true, sortable: false, filterable: false};
  doc.entities.Answer = {keys: ["RunId"], properties: {RunId: {type: "String(32)", field: "RUN_ID"}, Answer: "String"}, creatable: false, updatable: false, deletable: false, operations: []};
  for (const a of cockpitActions(m)) doc.functions[a.name] = {method: a.get ? "GET" : "POST", returns: {entity: "Answer", multiplicity: "1"}, parameters: a.params};
  doc.annotations.Run = {...doc.annotations.Run, header: {typeName: "Run", typeNamePlural: "Runs", title: "RunId", description: "Status"},
    selectionFields: ["CheckDate", "Status"], facets: entities.filter((e) => !["Run", "Setting", "Change"].includes(e.name)).map((e) => ({id: e.name, label: e.name, lineItem: `to_${e.name}`}))};
  // Input snapshots have a service-only read surface: existing UI facets stay put.
  const result = cockpitUi(m, {doc, entities});
  if (m.snapshots) {
    if (doc.entities.Snapshot) doc.entities.Snapshot.set = "ConfSnapSet";
    doc.entities.InputSnapshot = {set: "SnapshotSet", source: {table: "ZOSD_L3_SNAP"}, keys: ["SnapId"],
      properties: Object.fromEntries([["SetName", 16], ["SnapName", 16], ["SnapId", 32], ["ContentHash", 64], ["State", 8]]
        .map(([p, n]) => [p, {type: `String(${n})`, field: p.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase(), readonly: true}])
        .concat([["RowCount", {type: "Int32", field: "ROW_COUNT", readonly: true}], ["Created", {type: "DateTime", field: "CREATED", readonly: true}]])),
      creatable: false, updatable: false, deletable: false, operations: ["R", "Q"]};
    for (const [prop, spec] of Object.entries(doc.entities.InputSnapshot.properties)) {
      spec.label = words(prop);
      doc.annotations[`InputSnapshot/${prop}`] = {label: spec.label};
    }
    entities.push({name: "InputSnapshot", table: "zosd_l3_snap", method: "snapshotset",
      keys: [{field: "snap_id", property: "SnapId", last: true}], columns: [], has_run: false});
    // The settings entity retains its navigation identity and gets a distinct set.
    if (m.settings) entities.find((e) => e.name === "Snapshot").method = "confsnapset";
  }
  return result;
}
