// What the run page needs beyond the tables: words for every property, the
// computed fields the DPC fills (a title, counts, the budget's levels, the
// criticality of a status, what an action applies to, which sections are
// empty), the micro charts and the value lists. The service generator keeps
// the read model; this layer only adds to the document it built.
const LABELS = {
  RunId: "Run ID", SetName: "Set", CheckDate: "Check date", Status: "Status", Started: "Started", Ended: "Ended",
  StageNo: "Stage", StageName: "Stage name", Opened: "Opened", RunBind: "Work binding",
  RuleName: "Rule", PileNo: "Pile", ModelHash: "Model hash", RangeLow: "Range from", RangeHigh: "Range to",
  JobName: "Job name", JobCount: "Job number", Alerts: "Alerts", Attempt: "Attempt", Reason: "Reason",
  PerPile: "Pile cap", Hits: "Hits", Closed: "Closed alerts", OpenAlerts: "Open alerts",
  Reserved: "Reserved", Consumed: "Consumed", Refunded: "Refunded", Glass: "Glass", WarnAt: "Warn at (bp)",
  NarrowAt: "Narrow at (bp)", EventSeq: "Event sequence", State: "State", Warned: "Warned",
  Seq: "Sequence", Kind: "Kind", Acted: "When", Actor: "By", DocAction: "Doctor action",
  ParamName: "Setting", ParamVal: "Value", DslValue: "DSL default", Origin: "Origin", ChangedBy: "Changed by",
  ChangedAt: "Changed at", NoteText: "Note", OldValue: "Old value", NewValue: "New value",
};
export const words = (p) => LABELS[p] ?? p.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/ ([A-Z])(?=[a-z])/g, (_, c) => " " + c.toLowerCase());
// UI.CriticalityType: Fiori Elements V2 knows 0 to 3 only, so RUNNING is neutral here
export const CRITICALITY = {3: ["DONE"], 1: ["FAILED", "GLASS", "FUSED", "KILLED", "WRITE-FAILED"], 2: ["HELD", "NARROW", "PARTIAL", "WARN"]};
// the statuses a run shows, for the fixed value list of its filter
export const RUN_STATUSES = [["OPEN", "Open: the first stage runs"], ["WAITING", "Waiting: a stage waits for its gate"],
  ["SUBMITTED", "Submitted: background jobs carry the piles"], ["GLASS", "Stopped at the glass: a person continues it"],
  ["DONE", "Done"], ["PARTIAL", "Partial: piles did not complete"], ["FAILED", "Failed"], ["NOT-RUN", "Not run"], ["KILLED", "Killed"]];
// the order of the segments of the pile bar
export const TALLY = ["DONE", "RUNNING", "PLANNED", "HELD", "GLASS", "FAILED", "FUSED"];
const SECTIONS = {Stage: "Stages", Pile: "Piles", Budget: "Budget", Event: "Budget events", Doctor: "Doctor journal", Snapshot: "Settings of the run"};
// a computed field is filled after the read, so it can be neither filtered nor sorted on:
// $metadata says so, and the DPC refuses such a filter in words (refuse_computed)
const own = (type, label, field) => ({type, field, label, readonly: true, sortable: false, filterable: false});
export function cockpitUi(m, {doc, entities}) {
  const facets = entities.filter((e) => !["Run", "Setting", "Change"].includes(e.name));
  for (const [name, e] of Object.entries(doc.entities)) {
    for (const [p, spec] of Object.entries(e.properties)) if (typeof spec === "object") spec.label = words(p);
    const entity = entities.find((x) => x.name === name);
    if (!entity || !["Run", "Stage", "Pile", "Budget"].includes(name)) continue;
    // computed fields need a structure of the service's own: the DPC declares it from the
    // properties, so a date says it is one and a time stamp names its data element
    delete e.source;
    for (const spec of Object.values(e.properties)) {
      if (spec.type === "DateTime" && spec.field === "CHECK_DATE") spec.type = "Date";
      else if (spec.type === "DateTime") spec.typeName = "TIMESTAMP";
    }
  }
  const run = doc.entities.Run.properties;
  Object.assign(run, {Title: own("String(40)", "Run", "TITLE"), RunLabel: own("String(40)", "Run", "RUN_LABEL"),
    Mode: own("String(1)", "Mode", "RUN_MODE"), Twin: own("Boolean", "Twin", "TWIN"), Open: own("Boolean", "Open", "IS_OPEN"),
    Piles: own("Int32", "Piles", "PILES"), PilesFinal: own("Int32", "Piles final", "PILES_FINAL"),
    PilesDone: own("Int32", "Piles done", "PILES_DONE"), PilesRunning: own("Int32", "Piles running", "PILES_RUNNING"),
    PilesFailed: own("Int32", "Piles failed", "PILES_FAILED"), PilesHeld: own("Int32", "Piles held", "PILES_HELD"),
    PilesOrphaned: own("Int32", "Piles running without a live job", "PILES_ORPHANED"),
    PctFinal: own("Int32", "Piles done (%)", "PCT_FINAL"), StatusCriticality: own("Byte", "Status criticality", "STATUS_CRIT"),
    CanContinue: own("Boolean", "Can continue past glass", "CAN_CONTINUE"), CanResume: own("Boolean", "Can resume", "CAN_RESUME")});
  if (m.governor) Object.assign(run, {Reserved: own("Int32", "Budget reserved", "RESERVED"), Glass: own("Int32", "Glass", "GLASS"),
    WarnLevel: own("Int32", "Warn level", "WARN_LEVEL"), NarrowLevel: own("Int32", "Narrow level", "NARROW_LEVEL")});
  for (const f of facets) run[`Hide${f.name}`] = own("Boolean", `No ${f.name.toLowerCase()} rows`, `HIDE_${f.name.toUpperCase()}`);
  const crit = {Stage: ["StatusCriticality", "STATUS_CRIT", "status"], Pile: ["StatusCriticality", "STATUS_CRIT", "status"], Budget: ["StateCriticality", "STATE_CRIT", "state"]};
  for (const [name, [prop, field, of]] of Object.entries(crit)) {
    if (!doc.entities[name]) continue;
    doc.entities[name].properties[prop] = own("Byte", "Criticality", field);
    Object.assign(entities.find((e) => e.name === name), {has_crit: true, crit: field.toLowerCase(), crit_of: of, release: name === "Pile" && !!m.governor});
  }
  if (m.governor) doc.entities.Pile.properties.CanRelease = own("Boolean", "Can be released", "CAN_RELEASE");
  Object.assign(entities.find((e) => e.name === "Run"), {has_crit: true, crit: "status_crit", crit_of: "status",
    hides: facets.map((f) => ({table: f.table, field: `hide_${f.name.toLowerCase()}`}))});
  // the pile bar: one row per status of a run's piles
  doc.entities.Tally = {set: "TallySet", keys: ["RunId", "Status"], properties: {RunId: {...own("String(32)", "Run ID", "RUN_ID"), filterable: true},
    Status: own("String(12)", "Status", "STATUS"), Piles: own("Int32", "Piles", "PILES"), StatusCriticality: own("Byte", "Criticality", "STATUS_CRIT"),
    Label: own("String(24)", "Piles of the status", "LABEL")},
  creatable: false, updatable: false, deletable: false, operations: ["Q"]};
  doc.associations.RunToTally = {from: "Run", to: "Tally", cardinality: "1:N", constraint: {RunId: "RunId"}, navigation: {Run: "to_Tally"}};
  doc.entities.StatusVH = {set: "StatusVHSet", keys: ["Status"], properties: {Status: own("String(12)", "Status", "STATUS"), Text: own("String(60)", "Meaning", "TEXT")},
    creatable: false, updatable: false, deletable: false, operations: ["Q"]};
  const status = (p) => ({value: "Status", label: "Status", criticality: p});
  doc.annotations.Run = {
    header: {typeName: "Run", typeNamePlural: "Runs", title: "Title", description: "RunId"},
    selectionFields: ["CheckDate", "Status"],
    lineItem: [{value: "RunLabel", label: "Run"}, status("StatusCriticality"), {value: "PctFinal", label: "Piles done (%)"}, {value: "Started", label: "Started"}],
    // whose state each one is: the run's status, the piles done of planned, the budget
    headerFacets: [{id: "StatusPoint", label: "Run status", target: "@UI.DataPoint#Status"},
      {id: "FinalChart", label: "Piles done of planned", target: "@UI.Chart#Final"},
      ...(m.governor ? [{id: "BudgetChart", label: "Budget: reserved of the glass", target: "@UI.Chart#Budget"}] : []),
      {id: "TallyChart", label: "Piles by status", target: "to_Tally/@UI.Chart#Tally"}],
    dataPoints: {Status: {value: "Status", title: "Run status", criticality: "StatusCriticality"},
      Final: {value: "PilesDone", title: "Piles done", targetValue: "Piles"},
      ...(m.governor ? {Budget: {value: "Reserved", title: "Budget reserved", minimumValue: 0, maximumValue: "Glass",
        criticalityCalculation: {improvementDirection: "Minimize", toleranceRangeHighValue: "WarnLevel", deviationRangeHighValue: "NarrowLevel"}}} : {})},
    charts: {Final: {type: "Donut", title: "Piles done", measures: ["PilesDone"], measureAttributes: [{measure: "PilesDone", dataPoint: "Final"}]},
      ...(m.governor ? {Budget: {type: "Bullet", title: "Budget", measures: ["Reserved"], measureAttributes: [{measure: "Reserved", dataPoint: "Budget"}]}} : {})},
    facets: facets.map((e) => ({id: e.name, label: SECTIONS[e.name] ?? e.name, lineItem: `to_${e.name}`, hidden: `Hide${e.name}`}))};
  for (const name of ["Stage", "Pile"]) doc.annotations[name].lineItem = doc.annotations[name].lineItem.map((c) => c.value === "Status" ? status("StatusCriticality") : c);
  if (doc.annotations.Budget) doc.annotations.Budget.lineItem = doc.annotations.Budget.lineItem.map((c) => c.value === "State" ? {...c, criticality: "StateCriticality"} : c);
  for (const [name, a] of Object.entries(doc.annotations)) {
    if (a.lineItem) a.lineItem = a.lineItem.map((c) => ({...c, label: doc.entities[name].properties[c.value]?.label ?? words(c.value)}));
  }
  doc.annotations.Tally = {dataPoints: {Tally: {value: "Piles", title: "Piles", criticality: "StatusCriticality"}},
    // each segment says its status and count (Common.Text of the measure)
    charts: {Tally: {type: "BarStacked", title: "Piles by status", dimensions: ["Status"], measures: ["Piles"], measureAttributes: [{measure: "Piles", dataPoint: "Tally"}]}}};
  doc.annotations["Tally/Piles"] = {text: "Label"};
  doc.annotations["Run/Status"] = {valueListFixed: true, valueList: {label: "Status", collection: "StatusVHSet", search: false,
    parameters: [{inOut: {Status: "Status"}}, {displayOnly: "Text"}]}};
  doc.annotations.StatusVH = {lineItem: [{value: "Status", label: "Status"}, {value: "Text", label: "Meaning"}]};
  // the label as Common.Label too: sap:label comes from the MPC's text elements on a
  // system, and this runtime does not resolve text elements (it shows the field name)
  for (const [name, e] of Object.entries(doc.entities)) {
    if (name === "Answer") continue;
    for (const [p, spec] of Object.entries(e.properties)) {
      if (typeof spec === "object" && spec.label) doc.annotations[`${name}/${p}`] = {label: spec.label, ...doc.annotations[`${name}/${p}`]};
    }
  }
  // what each entity set refuses to filter on: its computed fields, by property and by ABAP field
  const refuse = (name) => {
    const props = Object.entries(doc.entities[name].properties).filter(([, p]) => p.filterable === false);
    // ABAP literals of a few names each: a generated line stays well under 255 characters
    const chunks = (names) => Array.from({length: Math.ceil(names.length / 5)}, (_, i) => ({text: `'${names.slice(i * 5, i * 5 + 5).join(" ")}'`}));
    return {prop_chunks: chunks(props.map(([p]) => p)), field_chunks: chunks(props.map(([, p]) => p.field))};
  };
  for (const e of entities) if (["Run", "Stage", "Pile", "Budget"].includes(e.name)) Object.assign(e, {has_computed: true}, refuse(e.name));
  const extra = {tally_refuse: refuse("Tally"), statusvh_refuse: refuse("StatusVH")};
  return {doc, entities, extra, tally: {statuses: TALLY, criticality: CRITICALITY}, statuses: RUN_STATUSES};
}
