// stg-compile: one YAML file for a Gateway service -> the SEGW objects.
//
//   npm run stg:compile -- src/demo/zstg_demo.stg.yaml [--out <dir>] [--lib <fugr folder>]
//
// SEGW is an editor for a project tree plus a generator. The tree is the
// IWPR object; the generator is tools/segw-gen.mjs. This is the editor
// without the GUI: `<name>.stg.yaml` describes the service (entities,
// properties, sets, associations, navigation, function imports, where each
// entity's data comes from) and stg-compile writes the tree as abapGit
// serializes it (`<project>.iwpr.xml`), the registration objects
// (`<service> 0001.iwsv.xml`, `<model> 0001.iwmo.xml`) and, through
// segw-gen, the `_MPC`/`_DPC` classes plus the empty `_EXT` pair. Deploy the
// folder with abapGit and SEGW on the system opens a normal project.
//
// Node identifiers are deterministic (a hash of project + kind + name), so
// compiling the same file twice gives the same tree, byte for byte.
//
// Format (see docs/stg-compile.md; every key but `project`, `service` and
// `entities` is optional):
//
//   project: ZSTG_DEMO                 # SEGW project; classes ZCL_<project>_MPC/_DPC(+_EXT)
//   service: ZSTG_DEMO_SRV             # technical = external name, version 0001
//   model: ZSTG_DEMO_MDL               # default <project>_MDL
//   description: ...
//   entities:
//     Travel:
//       set: TravelSet                 # default <name>Set
//       source: {struct: ZSTG_DEMO}    # ABAP structure behind the type (bind_structure)
//               {table: ZSTG_DEMO_BK}  # DDIC table served by SADL, the DPC delegates
//               {cds: ZSTG_I_STATUS}   # CDS view served by SADL
//               (none)                 # the DPC declares the structure from the properties
//       keys: [TravelId]
//       properties:
//         TravelId: String(8)          # shorthand: <Edm type>(<length>) or <type>(<digits>,<scale>)
//         Seats: {type: Int32, field: SEATS, nullable: true, label: Seats}
//         StatusText: {type: String(40), readonly: true, sortable: false, filterable: false}
//       creatable: true ... (set flags: creatable updatable deletable pageable addressable searchable subscribable filterRequired)
//       operations: [C, R, U, D, Q]    # the DPC methods SEGW writes; default all five
//   associations:
//     TravelToBookings:
//       from: Travel
//       to: Booking
//       cardinality: 1:N               # 1:1, 1:N, N:1, N:N (0..1 as 0)
//       constraint: {TravelId: TravelId}   # principal (from) -> dependent (to)
//       navigation: {Travel: to_Bookings, Booking: to_Travel}
//   functions:
//     CancelTravel:
//       method: POST
//       returns: {entity: Travel, set: TravelSet, multiplicity: "1"}   # or {complex: CT_X}
//       for: Travel
//       parameters: {TravelId: String(8)}
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {basename, dirname, join} from "node:path";
import yaml from "js-yaml";
import {generate} from "./segw-gen.mjs";
import {loadFunctionGroups} from "./segw-gen-mapping.mjs";

// ------------------------------------------------------------- the model

const EDM = {
  string: "Edm.String", int32: "Edm.Int32", int16: "Edm.Int16", int64: "Edm.Int64", boolean: "Edm.Boolean", datetime: "Edm.DateTime",
  decimal: "Edm.Decimal", guid: "Edm.Guid", time: "Edm.Time", byte: "Edm.Byte", double: "Edm.Double", binary: "Edm.Binary", datetimeoffset: "Edm.DateTimeOffset",
};

function edmType(name) {
  const key = String(name).replace(/^Edm\./, "").toLowerCase();
  if (!EDM[key]) {
    throw new Error(`unknown type ${name}`);
  }
  return EDM[key];
}

// "String(8)", "Decimal(15,2)", "Int32" -> {type, length, digits, scale}
function parseTypeText(text) {
  const m = /^\s*([A-Za-z][A-Za-z0-9.]*)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?\s*$/.exec(String(text));
  if (m === null) {
    throw new Error(`cannot read the type ${JSON.stringify(text)}`);
  }
  const type = edmType(m[1]);
  if (type === "Edm.Decimal" || type === "Edm.DateTime") {
    return {type, digits: m[2] ?? "", scale: m[3] ?? ""};
  }
  return {type, length: m[2] ?? ""};
}

function property(name, spec, isKey) {
  const s = typeof spec === "string" || spec === null || spec === undefined ? {type: spec ?? "String"} : {...spec};
  const t = parseTypeText(s.type ?? "String");
  const readonly = s.readonly === true;
  const flag = (key, fallback) => (s[key] === undefined ? fallback : s[key] === true);
  return {
    name,
    field: s.field ?? name.toUpperCase(),
    isKey,
    type: t.type,
    length: s.length !== undefined ? String(s.length) : t.length ?? "",
    digits: s.digits !== undefined ? String(s.digits) : t.digits ?? "",
    scale: s.scale !== undefined ? String(s.scale) : t.scale ?? "",
    creatable: flag("creatable", !readonly),
    updatable: flag("updatable", !readonly && !isKey),
    sortable: flag("sortable", true),
    nullable: flag("nullable", !isKey),
    filterable: flag("filterable", true),
    label: s.label ?? "",
    semantics: s.semantics ?? "",
    unicode: s.unicode !== false,
  };
}

function cardinality(text) {
  const m = /^\s*([01N*])\s*:\s*([01N*])\s*$/i.exec(String(text ?? "1:N"));
  if (m === null) {
    throw new Error(`cardinality ${JSON.stringify(text)}: use 1:N, 1:1, N:1, 0:N`);
  }
  const card = (c) => (c === "*" ? "N" : c.toUpperCase());
  return {left: card(m[1]), right: card(m[2])};
}

// the YAML, checked and defaulted
export function readModel(text, file = "stg.yaml") {
  const y = yaml.load(text) ?? {};
  for (const key of ["project", "service", "entities"]) {
    if (!y[key]) {
      throw new Error(`${file}: "${key}" is required`);
    }
  }
  const project = String(y.project).toUpperCase();
  const service = String(y.service).toUpperCase();
  const model = String(y.model ?? `${project}_MDL`).toUpperCase();
  const stem = project.replace(/^\/([^/]+)\//, "/$1/").toUpperCase();
  const cls = (suffix) => {
    // /NS/CL_<project>_MPC keeps the namespace in front
    const ns = /^\/([^/]+)\/(.*)$/.exec(stem);
    const base = ns ? `/${ns[1]}/CL_${ns[2]}` : `ZCL_${stem}`;
    return (y.classes?.[suffix.toLowerCase()] ?? `${base}_${suffix}`).toUpperCase();
  };
  const entities = Object.entries(y.entities).map(([name, e]) => {
    const spec = e ?? {};
    const keys = (spec.keys ?? []).map(String);
    const props = Object.entries(spec.properties ?? {}).map(([p, ps], i) => ({...property(p, ps, keys.includes(p)), order: i + 1}));
    for (const k of keys) {
      if (!props.some((p) => p.name === k)) {
        throw new Error(`${file}: ${name}: key ${k} is not a property`);
      }
    }
    const source = spec.source ?? {};
    if (Object.keys(source).length > 1) {
      throw new Error(`${file}: ${name}: one source only`);
    }
    const flag = (key, fallback) => (spec[key] === undefined ? fallback : spec[key] === true);
    const sadl = source.table ? {kind: "DDIC", binding: String(source.table).toUpperCase()} : source.cds ? {kind: "CDS", binding: String(source.cds)} : undefined;
    return {
      name, set: spec.set ?? `${name}Set`, keys, properties: props, description: spec.description ?? "",
      abapStruct: source.struct ? String(source.struct).toUpperCase() : sadl ? sadl.binding.toUpperCase() : "",
      sadl,
      creatable: flag("creatable", true), updatable: flag("updatable", true), deletable: flag("deletable", true),
      pageable: flag("pageable", true), addressable: flag("addressable", true), searchable: flag("searchable", false),
      subscribable: flag("subscribable", false), filterRequired: flag("filterRequired", false),
      operations: (spec.operations ?? ["C", "R", "U", "D", "Q"]).map((o) => String(o).toUpperCase()),
    };
  });
  const entity = (n) => {
    const found = entities.find((e) => e.name === n);
    if (!found) {
      throw new Error(`${file}: entity ${n} is not defined`);
    }
    return found;
  };
  const associations = Object.entries(y.associations ?? {}).map(([name, a]) => {
    const spec = a ?? {};
    const from = entity(spec.from);
    const to = entity(spec.to);
    const card = cardinality(spec.cardinality);
    const constraint = Object.entries(spec.constraint ?? {}).map(([principal, dependent]) => ({principal, dependent: String(dependent)}));
    const navigation = Object.entries(spec.navigation ?? {}).map(([owner, nav]) => ({entity: entity(owner), name: String(nav)}));
    return {name, from, to, card, constraint, navigation, set: spec.set ?? `${name}Set`};
  });
  const functions = Object.entries(y.functions ?? {}).map(([name, f]) => {
    const spec = f ?? {};
    const returns = spec.returns ?? {};
    return {
      name,
      method: (spec.method ?? "POST").toUpperCase(),
      returnEntity: returns.entity ? entity(returns.entity) : undefined,
      returnSet: returns.set ?? (returns.entity ? entity(returns.entity).set : ""),
      multiplicity: String(returns.multiplicity ?? (returns.entity ? "1" : "")),
      actionFor: spec.for ? entity(spec.for) : undefined,
      parameters: Object.entries(spec.parameters ?? {}).map(([p, ps]) => property(p, ps, false)),
    };
  });
  return {
    project, service, model, description: y.description ?? "", namespace: y.namespace ?? service,
    classes: {mpc: cls("MPC"), mpcExt: cls("MPC_EXT"), dpc: cls("DPC"), dpcExt: cls("DPC_EXT")},
    entities, associations, functions,
  };
}

// ----------------------------------------------------------------- IWPR

// a stable 22-character node id in the shape SEGW uses (base64 of a GUID)
function nodeId(...parts) {
  return createHash("sha1").update(parts.join("")).digest("base64").slice(0, 22) + "==";
}

const X = (b) => (b ? "X" : "");
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;").replaceAll("\"", "&quot;");

// one abapGit table block: <TAG><TAG>row</TAG>...</TAG>; rows are ordered
// by the fields given, empty values are left out as abapGit does
function table(tag, rows) {
  if (rows.length === 0) {
    return "";
  }
  let s = `   <_-IWBEP_-I_${tag}>\n`;
  for (const row of rows) {
    s += `    <_-IWBEP_-I_${tag}>\n`;
    for (const [k, v] of Object.entries(row)) {
      if (v !== "" && v !== undefined && v !== false) {
        s += `     <${k}>${esc(v)}</${k}>\n`;
      }
    }
    s += `    </_-IWBEP_-I_${tag}>\n`;
  }
  return s + `   </_-IWBEP_-I_${tag}>\n`;
}

const OPERATIONS = {C: "Create", R: "GetEntity (Read)", U: "Update", D: "Delete", Q: "GetEntitySet (Query)"};
const OP_SUFFIX = {C: "CREATE_ENTITY", R: "GET_ENTITY", U: "UPDATE_ENTITY", D: "DELETE_ENTITY", Q: "GET_ENTITYSET"};

export function iwprXml(m, opts = {}) {
  const P = m.project;
  const id = (...parts) => nodeId(P, ...parts);
  const projectId = id("PROJ");
  const modelId = id("MODL");
  const serviceId = id("SRVC");
  const dataSourcesId = id("DSRC");
  const rows = {
    SBD_AT: [], SBD_DS: [], SBD_DST: [], SBD_GA: [], SBD_GAT: [], SBD_MD: [], SBD_MDT: [], SBD_MH: [], SBD_OP: [], SBD_OPT: [], SBD_PR: [], SBD_PRT: [],
    SBD_SE: [], SBD_SET: [], SBD_SV: [], SBD_SVT: [], SBO_ASO: [], SBO_AST: [], SBO_AT: [], SBO_ATT: [], SBO_ES: [], SBO_EST: [], SBO_ET: [], SBO_ETT: [],
    SBO_FI: [], SBO_FIT: [], SBO_FP: [], SBO_FPT: [], SBO_NP: [], SBO_NPT: [], SBO_PR: [], SBO_PRT: [], SBO_RC: [], SBO_RCT: [],
  };
  const stamp = opts.timestamp ?? "20260912000000.000000";
  const text = (uuid, description, extra = {}) => ({PROJECT: P, SYLANGU: "E", NODE_UUID: uuid, DESCRIPTION: description, ...extra});

  rows.SBD_PR.push({PROJECT: P, NODE_UUID: projectId, CREATION_USER_ID: "STEAMGATE", CREATION_TIME: stamp, LAST_CHG_USER_ID: "STEAMGATE", LAST_CHG_TIME: stamp, PLUGIN: "/IWBEP/GEN", STRAT_NAME: "0001", STRAT_VERSION: "0001", PROJECT_TYPE: "1"});
  rows.SBD_PRT.push({PROJECT: P, SYLANGU: "E", DESCRIPTION: m.description});
  rows.SBD_MD.push({PROJECT: P, NODE_UUID: modelId, NODE_UUID_PA: projectId, PLUGIN_PA: "/IWBEP/CORE", NODE_TYPE_PA: "PROJ", TECHNICAL_NAME: m.model, VERSION: "0001", MPC: m.classes.mpcExt, STATE_NS: "S", VALUE_NS: m.namespace});
  rows.SBD_MDT.push({PROJECT: P, SYLANGU: "E", NODE_UUID: modelId, DESCRIPTION: m.description});
  rows.SBD_SV.push({PROJECT: P, NODE_UUID: serviceId, TECHNICAL_NAME: m.service, VERSION: "0001", DPC: m.classes.dpcExt, EXTERNAL_NAME: m.service});
  rows.SBD_SVT.push({PROJECT: P, SYLANGU: "E", NODE_UUID: serviceId, DESCRIPTION: m.description});

  const artifacts = [["MPCB", m.classes.mpc, "CLAS"], ["MPCS", m.classes.mpcExt, "CLAS"], ["DPCB", m.classes.dpc, "CLAS"], ["DPCS", m.classes.dpcExt, "CLAS"], ["MDL", m.model, "IWMO"], ["SRV", m.service, "IWSV"]];
  for (const [kind, name, type] of artifacts) {
    rows.SBD_GA.push({PROJECT: P, NODE_UUID: id("GA", kind), NAME: name, PGMID: "R3TR", TROBJ_TYPE: type, TROBJ_NAME: name, GEN_ART_TYPE: kind});
    rows.SBD_GAT.push({PROJECT: P, SYLANGU: "E", NODE_UUID: id("GA", kind), DESCRIPTION: name});
  }

  const etId = (e) => id("ETYP", e.name);
  const esId = (e) => id("ESET", e.set);
  const prId = (e, p) => id("PROP", e.name, p.name);
  for (const e of m.entities) {
    rows.SBO_ET.push({PROJECT: P, NODE_UUID: etId(e), MODEL: modelId, NAME: e.name, ABAP_STRUCT: e.abapStruct, TECH_NAME: e.name.toUpperCase(), REF_TYPE: "T", DESCRIPTION_XU: X(!e.description)});
    rows.SBO_ETT.push(text(etId(e), e.description || e.name));
    for (const p of e.properties) {
      rows.SBO_PR.push({
        PROJECT: P, NODE_UUID: prId(e, p), PARENT_UUID: etId(e), NAME: p.name, IS_KEY: X(p.isKey), CREATABLE: X(p.creatable), UPDATABLE: X(p.updatable),
        SORTABLE: X(p.sortable), FILTERABLE: X(p.filterable), IS_NULLABLE: X(p.nullable), MAX_LENGTH: p.length, PROP_PRECISION: p.digits, SCALE: p.scale,
        SEMANTICS: p.semantics, EDM_CORE_TYPE: p.type, REF_TYPE: "T", ABAP_FIELD: p.field, ABTY_XU: "X", SORT_ORDER: String(p.order),
        IS_UNICODE_XU: X(!p.unicode), DESCRIPTION_XU: "X",
      });
      rows.SBO_PRT.push({PROJECT: P, SYLANGU: "E", NODE_UUID: prId(e, p), PROP_LABEL: p.label});
    }
    rows.SBO_ES.push({
      PROJECT: P, NODE_UUID: esId(e), MODEL: modelId, NAME: e.set, ENTITY_TYPE: etId(e), CREATABLE: X(e.creatable), UPDATABLE: X(e.updatable), DELETABLE: X(e.deletable),
      PAGEABLE: X(e.pageable), ADDRESSABLE: X(e.addressable), SEARCHABLE: X(e.searchable), SUBSCRIBABLE: X(e.subscribable), REQUIRES_FLT: X(e.filterRequired),
      REF_TYPE: "T", TECH_NAME: e.set.toUpperCase(), DESCRIPTION_XU: "X",
    });
    rows.SBO_EST.push(text(esId(e), e.set));
    // the design side: the entity set's node, one operation node per method
    const seId = id("DSET", e.set);
    rows.SBD_SE.push({PROJECT: P, NODE_UUID: seId, PARENT_UUID: id("DSETS"), NAME: e.set, ENTITY_SET_UUID: esId(e)});
    rows.SBD_SET.push(text(seId, e.set));
    for (const op of ["C", "R", "U", "D", "Q"].filter((o) => e.operations.includes(o))) {
      const opId = id("OPER", e.set, op);
      rows.SBD_OP.push({PROJECT: P, NODE_UUID: opId, PARENT_UUID: seId, NAME: OPERATIONS[op], OPERATION_TYPE: op, IMP_METHOD: `${e.set.toUpperCase().slice(0, 16)}_${OP_SUFFIX[op]}`});
      rows.SBD_OPT.push(text(opId, OPERATIONS[op]));
    }
    if (e.sadl) {
      const dsId = id("DSRC", e.name);
      rows.SBD_DS.push({PROJECT: P, NODE_UUID: dsId, PARENT_UUID: dataSourcesId, DS_GROUP: `${e.sadl.kind}~${e.sadl.binding}`, DS_TYPE: "4"});
      rows.SBD_DST.push(text(dsId, `${e.sadl.kind} ${e.sadl.binding}`));
      rows.SBD_MH.push({PROJECT: P, NODE_UUID: id("MAPH", e.set), PARENT_UUID: seId, NAME: "Mapping", DS_UUID: dsId});
    }
  }

  for (const a of m.associations) {
    const asoId = id("ASSO", a.name);
    rows.SBO_ASO.push({
      PROJECT: P, NODE_UUID: asoId, MODEL: modelId, NAME: a.name, LEFT_END_GUID: etId(a.from), RIGHT_END_GUID: etId(a.to),
      LEFT_END_CARD: a.card.left, RIGHT_END_CARD: a.card.right, REF_TYPE: "T", TECH_NAME: a.name.toUpperCase(), DESCRIPTION_XU: "X",
    });
    rows.SBO_AST.push(text(asoId, a.name));
    for (const c of a.constraint) {
      const principal = a.from.properties.find((p) => p.name === c.principal);
      const dependent = a.to.properties.find((p) => p.name === c.dependent);
      if (!principal || !dependent) {
        throw new Error(`${a.name}: constraint ${c.principal} -> ${c.dependent} names a property that is not there`);
      }
      const rcId = id("RCON", a.name, c.principal, c.dependent);
      rows.SBO_RC.push({PROJECT: P, NODE_UUID: rcId, ASSOCIATION_GUID: asoId, NAME: c.dependent, PRINCIPAL_PROP_R: prId(a.from, principal), DEPENDENT_PROP_R: prId(a.to, dependent), REF_TYPE: "T", DESCRIPTION_XU: "X"});
      rows.SBO_RCT.push(text(rcId, c.dependent));
    }
    const atId = id("ASET", a.set);
    rows.SBO_AT.push({PROJECT: P, NODE_UUID: atId, MODEL: modelId, NAME: a.set, ASSOCIATION_GUID: asoId, LEFT_END_GUID: esId(a.from), RIGHT_END_GUID: esId(a.to), REF_TYPE: "T", TECH_NAME: a.set.toUpperCase(), DESCRIPTION_XU: "X"});
    rows.SBO_ATT.push(text(atId, a.set));
    for (const n of a.navigation) {
      const npId = id("NAVP", n.entity.name, n.name);
      rows.SBO_NP.push({PROJECT: P, NODE_UUID: npId, ENTITY_GUID: etId(n.entity), NAME: n.name, RELATION_GUID: asoId, REF_TYPE: "T", TECH_NAME: n.name.toUpperCase(), DESCRIPTION_XU: "X"});
      rows.SBO_NPT.push(text(npId, n.name));
    }
  }

  for (const f of m.functions) {
    const fiId = id("FUNC", f.name);
    rows.SBO_FI.push({
      PROJECT: P, NODE_UUID: fiId, MODEL: modelId, NAME: f.name, HTTP_METHOD: f.method, ACTION_FOR: f.actionFor ? etId(f.actionFor) : "",
      RETURN_CARD: f.multiplicity, RETURN_REF_TYPE: f.returnEntity ? etId(f.returnEntity) : "", RETURN_TYPE_KIND: f.returnEntity ? "ETYP" : "",
      RETURN_ENTITYSET: f.returnSet ? esId(m.entities.find((e) => e.set === f.returnSet) ?? f.returnEntity) : "", REF_TYPE: "T", DESCRIPTION_XU: "X",
    });
    rows.SBO_FIT.push(text(fiId, f.name));
    for (const p of f.parameters) {
      const fpId = id("FPAR", f.name, p.name);
      rows.SBO_FP.push({PROJECT: P, NODE_UUID: fpId, NAME: p.name, FUNCTION_IMPORT: fiId, ABAP_FIELD: p.field, EDM_CORE_TYPE: p.type, MAX_LENGTH: p.length, REF_TYPE: "T", ABTY_XU: "X", DESCRIPTION_XU: "X"});
      rows.SBO_FPT.push(text(fpId, p.name));
    }
  }

  let body = "";
  for (const tag of Object.keys(rows).sort()) {
    body += table(tag, rows[tag]);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWPR" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${body}  </asx:values>
 </asx:abap>
</abapGit>
`;
}

// --------------------------------------------------------- IWSV / IWMO

export function iwsvXml(m) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWSV" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <_-IWBEP_-I_MGW_SRG>
    <_-IWBEP_-I_MGW_SRG>
     <GROUP_TECH_NAME>${m.service}</GROUP_TECH_NAME>
     <GROUP_VERSION>0001</GROUP_VERSION>
     <MODEL_TECH_NAME>${m.model}</MODEL_TECH_NAME>
     <MODEL_VERSION>0001</MODEL_VERSION>
    </_-IWBEP_-I_MGW_SRG>
   </_-IWBEP_-I_MGW_SRG>
   <_-IWBEP_-I_MGW_SRH>
    <_-IWBEP_-I_MGW_SRH>
     <TECHNICAL_NAME>${m.service}</TECHNICAL_NAME>
     <VERSION>0001</VERSION>
     <EXTERNAL_NAME>${m.service}</EXTERNAL_NAME>
     <CLASS_NAME>${m.classes.dpcExt}</CLASS_NAME>
     <IS_SAP_SERVICE>-</IS_SAP_SERVICE>
    </_-IWBEP_-I_MGW_SRH>
   </_-IWBEP_-I_MGW_SRH>
   <_-IWBEP_-I_MGW_SRT>
    <_-IWBEP_-I_MGW_SRT>
     <TECHNICAL_NAME>${m.service}</TECHNICAL_NAME>
     <VERSION>0001</VERSION>
     <LANGUAGE>E</LANGUAGE>
     <DESCRIPTION>${esc(m.description)}</DESCRIPTION>
    </_-IWBEP_-I_MGW_SRT>
   </_-IWBEP_-I_MGW_SRT>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

export function iwmoXml(m) {
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWMO" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <_-IWBEP_-I_MGW_OHD>
    <_-IWBEP_-I_MGW_OHD>
     <TECHNICAL_NAME>${m.model}</TECHNICAL_NAME>
     <VERSION>0001</VERSION>
     <CLASS_NAME>${m.classes.mpcExt}</CLASS_NAME>
    </_-IWBEP_-I_MGW_OHD>
   </_-IWBEP_-I_MGW_OHD>
   <_-IWBEP_-I_MGW_OHT>
    <_-IWBEP_-I_MGW_OHT>
     <TECHNICAL_NAME>${m.model}</TECHNICAL_NAME>
     <VERSION>0001</VERSION>
     <LANGUAGE>E</LANGUAGE>
     <DESCRIPTION>${esc(m.description)}</DESCRIPTION>
    </_-IWBEP_-I_MGW_OHT>
   </_-IWBEP_-I_MGW_OHT>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

// abapGit names: /NS/X -> #ns#x; IWSV/IWMO keys are the technical name
// padded to 34 plus the version
const objectFile = (name, ext) => name.toLowerCase().replaceAll("/", "#") + ext;
const versionedFile = (name, ext) => name.toLowerCase().padEnd(34, " ") + "0001" + ext;

// everything the folder gets: the tree, the registration objects, the
// classes (generated from the tree by segw-gen, so what SEGW would write)
export function compile(text, opts = {}) {
  const m = readModel(text, opts.file);
  const iwpr = iwprXml(m, opts);
  const files = {
    [objectFile(m.project, ".iwpr.xml")]: iwpr,
    [versionedFile(m.service, ".iwsv.xml")]: iwsvXml(m),
    [versionedFile(m.model, ".iwmo.xml")]: iwmoXml(m),
  };
  const warnings = [];
  const generated = generate(iwpr, {functionModules: opts.functionModules ?? new Map(), warnings, ...(opts.generateOptions ?? {})});
  return {model: m, iwpr, files, classes: generated.files, ext: generated.ext, segw: generated.model, warnings};
}

// ------------------------------------------------------------------ CLI

if (process.argv[1] && /stg-compile\.mjs$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const valued = ["--out", "--lib"];
  const file = args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1]));
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
  const libs = args.flatMap((a, i) => (a === "--lib" ? [args[i + 1]] : []));
  if (!file) {
    console.error("usage: stg-compile.mjs <service.stg.yaml> [--out <dir>] [--lib <folder with *.fugr.xml>]...");
    process.exit(2);
  }
  const result = compile(readFileSync(file, "utf8"), {file: basename(file), functionModules: loadFunctionGroups([dirname(file), ...libs])});
  const m = result.model;
  console.log(`stg-compile: ${m.project} -> service ${m.service}, model ${m.model}: ${m.entities.length} entities, ${m.associations.length} associations, ${m.functions.length} function imports; classes ${Object.values(m.classes).join(", ")}`);
  for (const w of result.warnings) {
    console.log(`  warning: ${w}`);
  }
  if (out) {
    mkdirSync(out, {recursive: true});
    for (const [name, content] of Object.entries({...result.files, ...result.classes})) {
      writeFileSync(join(out, name), content);
    }
    // the _EXT pair is the developer's: written once, never overwritten
    for (const [name, content] of Object.entries(result.ext)) {
      if (!existsSync(join(out, name))) {
        writeFileSync(join(out, name), content);
      }
    }
    console.log(`  written to ${out}: ${Object.keys(result.files).length} objects, ${Object.keys(result.classes).length} class files, _EXT pair if it was missing`);
  } else {
    process.stdout.write(result.iwpr);
  }
}
