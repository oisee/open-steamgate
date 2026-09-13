#!/usr/bin/env node
// CDS (DDLS) -> what the transpiler and the SADL runtime need.
//
// For every src/cds/*.ddls.asddls that is a projection of one table or DDIC
// view (no joins yet) this writes into gen/cds/:
//   <SQLVIEW>.view.xml            DDIC view in abapGit form: the transpiler
//                                 creates the SQLite view from it and ABAP can
//                                 SELECT FROM it with typed fields
//   zcl_stg_cds_<sqlview>.clas.abap  a zif_stg_cds_source over that view
//                                 (static FROM; WHERE/ORDER BY/field list and
//                                 GROUP BY dynamic)
//   zcl_stg_cds_registry.clas.abap  entity metadata for the SADL exposure:
//                                 fields with EDM types, keys, labels, all
//                                 annotations, associations with their ON
//                                 pairs and cardinality
// The DDLS objects themselves stay out of the transpiler input (it rejects
// the object type); abaplint lints them.
import * as abaplint from "@abaplint/core";
import {readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync} from "node:fs";
import {join} from "node:path";

const OUT = "gen/cds";
const LIBS = [".local/lars/open-abap-core/src", ".local/fork/open-abap-odata/src"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "output", ".git"].includes(e.name)) walk(p, out); }
    else if (/\.(abap|xml|asddls)$/.test(e.name) && !e.name.endsWith(".clas.testclasses.abap")) out.push(p);
  }
  return out;
}
const mem = (paths) => paths.map((p) => new abaplint.MemoryFile(p, readFileSync(p, "utf8")));

function tokensOf(node) { return node?.concatTokens?.() ?? ""; }
function nodeName(node) { return node.get?.().constructor?.name ?? ""; }
function children(node) { return node.getChildren?.() ?? []; }
function find(node, name) { const out = []; const rec = (n) => { if (nodeName(n) === name) out.push(n); for (const c of children(n)) rec(c); }; rec(node); return out; }
function firstDirect(node, name) { return children(node).find((c) => nodeName(c) === name); }
function normAnno(text) { return text.replace(/\s*\.\s*/g, ".").replace(/\s*:\s*/g, ": ").replace(/@\s+/g, "@").trim(); }

// cast( '' as abap.char( 20 ) ) -> the ABAP type of the virtual element and
// what it is in OData; the handful of types a calculated element uses
function castType(text) {
  const m = /as\s+abap\s*\.\s*(\w+)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?/i.exec(String(text));
  if (!m) return undefined;
  const kind = m[1].toLowerCase();
  const a = Number(m[2] ?? 0);
  const b = Number(m[3] ?? 0);
  switch (kind) {
    case "char": return {abap: `c LENGTH ${a || 1}`, edm: {edm: "Edm.String", maxlength: a || 1}};
    case "numc": return {abap: `n LENGTH ${a || 1}`, edm: {edm: "Edm.String", maxlength: a || 1}};
    case "sstring": case "string": return {abap: "string", edm: {edm: "Edm.String", maxlength: a || 0}};
    case "int1": case "int2": case "int4": return {abap: "i", edm: {edm: "Edm.Int32"}};
    case "int8": return {abap: "int8", edm: {edm: "Edm.Int64"}};
    case "dats": return {abap: "d", edm: {edm: "Edm.DateTime", precision: 0}};
    case "tims": return {abap: "t", edm: {edm: "Edm.Time"}};
    case "dec": case "curr": case "quan":
      return {abap: `p LENGTH ${Math.floor((a || 15) / 2) + 1} DECIMALS ${b}`, edm: {edm: "Edm.Decimal", precision: a || 15, scale: b}};
    default: return undefined;
  }
}

function edmOf(type) {
  const n = type?.constructor?.name ?? "VoidType";
  const len = type?.getLength?.() ?? 0;
  switch (n) {
    case "CharacterType": return {edm: "Edm.String", maxlength: len};
    case "NumericType": return {edm: "Edm.String", maxlength: len};
    case "StringType": return {edm: "Edm.String", maxlength: 0};
    case "IntegerType": case "Integer8Type": return {edm: "Edm.Int32", maxlength: 0};
    case "PackedType": return {edm: "Edm.Decimal", precision: len * 2 - 1, scale: type.getDecimals?.() ?? 0};
    case "FloatType": case "DecFloat16Type": case "DecFloat34Type": return {edm: "Edm.Decimal", precision: 34, scale: 0};
    case "DateType": return {edm: "Edm.DateTime", precision: 0};
    case "TimeType": return {edm: "Edm.Time", precision: 0};
    default: return {edm: "Edm.String", maxlength: len};
  }
}

function parseDDLS(obj, reg) {
  const p = obj.getParsedData();
  const tree = p?.tree;
  if (!tree) return undefined;
  const name = obj.getName();
  const sqlView = (p.sqlViewName ?? name).toUpperCase();
  const viewAnnotations = children(tree).filter((c) => nodeName(c) === "CDSAnnotation").map((c) => normAnno(tokensOf(c)));
  const select = firstDirect(tree, "CDSSelect");
  if (!select) return {name, skip: "no select"};
  const sources = find(select, "CDSSource").map((s) => tokensOf(s).replace(/\s+as\s+\w+$/i, "").trim().toUpperCase());
  if (find(select, "CDSJoin").length > 0 || sources.length !== 1) return {name, skip: "joins are not supported yet"};
  const source = sources[0].replace(/\s+/g, "");
  const table = reg.getObject("TABL", source) ?? reg.getObject("VIEW", source);
  const comps = new Map();
  for (const c of table?.parseType(reg)?.getComponents?.() ?? []) comps.set(c.name.toUpperCase(), c.type);

  const fields = [];
  const exposedAssociations = [];
  for (const el of find(select, "CDSElement")) {
    const annos = children(el).filter((c) => nodeName(c) === "CDSAnnotation").map((c) => normAnno(tokensOf(c)));
    const isKey = children(el).some((c) => nodeName(c) === "Identifier" && tokensOf(c).toLowerCase() === "key");
    const as = firstDirect(el, "CDSAs");
    const alias = as ? tokensOf(firstDirect(as, "CDSName")) : undefined;
    const src = children(el).find((c) => nodeName(c) === "CDSName" || nodeName(c) === "CDSPrefixedName");
    const srcName = src ? tokensOf(src).replace(/\s+/g, "") : undefined;
    // a virtual element: no column behind it, an ABAP class calculates it
    // after the read (@ObjectModel.virtualElement + virtualElementCalculatedBy,
    // written as cast( '' as abap.<type> ) as <Name>)
    const cast = firstDirect(el, "CDSCast");
    if (cast && annos.some((a) => /@ObjectModel\.virtualElement:\s*true/i.test(a))) {
      const fieldName = (alias ?? "").toUpperCase();
      // normAnno has put a space after every colon, the one inside 'ABAP:...' too
      const by = annos.map((a) => /@ObjectModel\.virtualElementCalculatedBy:\s*'ABAP:\s*([^']+)'/i.exec(a)?.[1]?.trim()).find(Boolean);
      if (!fieldName || !by) {
        return {name, skip: `virtual element without an alias or a calculating class`};
      }
      const t = castType(tokensOf(cast));
      if (!t) {
        return {name, skip: `virtual element ${fieldName}: cannot read the cast type`};
      }
      const label = annos.map((a) => /@EndUserText\.label:\s*'([^']*)'/.exec(a)?.[1]).find(Boolean);
      fields.push({name: fieldName, base: "", key: false, ...t.edm, abapType: t.abap,
        virtual: true, calculatedBy: by.toUpperCase(), label: label ?? fieldName, annotations: annos});
      continue;
    }
    if (!srcName) continue;
    if (srcName.startsWith("_")) { exposedAssociations.push(srcName); continue; }
    if (/[()+\-*\/]/.test(srcName) || /^'/.test(srcName)) continue; // expressions: not yet
    const fieldName = (alias ?? srcName.split(".").pop()).toUpperCase();
    const baseField = srcName.split(".").pop().toUpperCase();
    const t = edmOf(comps.get(baseField));
    const label = annos.map((a) => /@EndUserText\.label:\s*'([^']*)'/.exec(a)?.[1]).find(Boolean);
    fields.push({name: fieldName, base: baseField, key: isKey, ...t, label: label ?? fieldName, annotations: annos});
  }

  const associations = [];
  for (const a of find(select, "CDSAssociation")) {
    const card = tokensOf(firstDirect(a, "CDSCardinality")).replace(/\s+/g, "");
    const m = /\[(\d+)\.\.(\d+|\*)\]/.exec(card);
    const toks = tokensOf(a);
    const target = /\bto\s+(\S+)/i.exec(toks)?.[1]?.toUpperCase();
    const alias = /\bas\s+(\S+)\s+on\b/i.exec(toks)?.[1] ?? target;
    const cond = tokensOf(firstDirect(a, "CDSCondition")) ?? "";
    const pairs = [];
    for (const part of cond.split(/\s+and\s+/i)) {
      const pm = /\$projection\s*\.\s*(\w+)\s*=\s*\w+\s*\.\s*(\w+)|(\w+)\s*\.\s*(\w+)\s*=\s*\$projection\s*\.\s*(\w+)/i.exec(part);
      if (pm) pairs.push(pm[1] ? {source: pm[1].toUpperCase(), target: pm[2].toUpperCase()} : {source: pm[5].toUpperCase(), target: pm[4].toUpperCase()});
    }
    associations.push({alias, target, min: m?.[1] ?? "0", max: m?.[2] ?? "*", pairs, exposed: exposedAssociations.includes(alias)});
  }
  const label = viewAnnotations.map((a) => /@EndUserText\.label:\s*'([^']*)'/.exec(a)?.[1]).find(Boolean) ?? name;

  // a writable projection: the view says so (@ObjectModel.writeEnabled, or
  // the finer create/update/delete switches), it reads from one table, and
  // every key column of that table is a field of the view. Anything else
  // (a join, an aggregate, a key that is not exposed) stays read-only, the
  // way SADL refuses to write through a view it cannot map back.
  const flag = (pattern) => viewAnnotations.some((a) => new RegExp(`@ObjectModel\\.${pattern}:\\s*true`, "i").test(a));
  const asked = flag("writeEnabled");
  const isTable = reg.getObject("TABL", source) !== undefined;
  const keyColumns = (table?.listKeys?.(reg) ?? []).map((k) => k.toUpperCase());
  const mapped = new Map(fields.filter((f) => !f.virtual && f.base).map((f) => [f.base.toUpperCase(), f.name]));
  const mandt = comps.has("MANDT");
  const missing = keyColumns.filter((k) => k !== "MANDT" && !mapped.has(k));
  const writable = (asked || flag("createEnabled") || flag("updateEnabled") || flag("deleteEnabled"))
    && isTable && missing.length === 0 && !viewAnnotations.some((a) => /@Analytics\.dataCategory/i.test(a));
  const write = {
    writable,
    why: !asked && !flag("createEnabled") && !flag("updateEnabled") && !flag("deleteEnabled") ? "the view does not ask for it"
      : !isTable ? `${source} is not a table`
      : missing.length > 0 ? `the key ${missing.join(", ")} of ${source} is not a field of the view`
      : viewAnnotations.some((a) => /@Analytics\.dataCategory/i.test(a)) ? "an analytical view is read-only"
      : "",
    creatable: asked || flag("createEnabled"),
    updatable: asked || flag("updateEnabled"),
    deletable: asked || flag("deleteEnabled"),
    keyColumns: keyColumns.filter((k) => k !== "MANDT"),
    mandt,
  };
  return {name, sqlView, source, fields, associations, viewAnnotations, label, write};
}

function viewXml(e) {
  const dd27 = e.fields.filter((f) => !f.virtual).map((f) => `    <DD27P>
     <VIEWFIELD>${f.name}</VIEWFIELD>
     <TABNAME>${e.source}</TABNAME>
     <FIELDNAME>${f.base}</FIELDNAME>${f.key ? "\n     <KEYFLAG>X</KEYFLAG>" : ""}
    </DD27P>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_VIEW" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD25V>
    <VIEWNAME>${e.sqlView}</VIEWNAME>
    <AS4LOCAL>A</AS4LOCAL>
    <DDLANGUAGE>E</DDLANGUAGE>
    <AGGTYPE>V</AGGTYPE>
    <ROOTTAB>${e.source}</ROOTTAB>
    <DDTEXT>${e.label.replace(/[<>&]/g, "")}</DDTEXT>
    <VIEWCLASS>D</VIEWCLASS>
    <VIEWGRANT>R</VIEWGRANT>
   </DD25V>
   <DD26V_TABLE>
    <DD26V>
     <VIEWNAME>${e.sqlView}</VIEWNAME>
     <TABNAME>${e.source}</TABNAME>
     <TABPOS>0001</TABPOS>
     <FORTABNAME>${e.source}</FORTABNAME>
    </DD26V>
   </DD26V_TABLE>
   <DD27P_TABLE>
${dd27}
   </DD27P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}

function sourceClass(e) {
  const cls = "zcl_stg_cds_" + e.sqlView.toLowerCase();
  const view = e.sqlView.toLowerCase();
  const virtual = e.fields.filter((f) => f.virtual);
  // the row the SADL runtime hands out: the columns of the SQL view plus the
  // virtual elements, which no SELECT fills (an ABAP class does, after the
  // read). A DPC over this entity declares its table as tt_row.
  const rowDecl = `    TYPES: BEGIN OF ty_row.
        INCLUDE TYPE ${view}.
${virtual.length === 0 ? "    TYPES: " : `    TYPES: ${virtual.map((f) => `${f.name.toLowerCase()} TYPE ${f.abapType}`).join(",\n           ")},\n           `}END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
`;
  const writable = e.write?.writable === true;
  return `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/cds2ddic.mjs from ${e.name} - do not edit
  PUBLIC SECTION.
${rowDecl}    INTERFACES zif_stg_cds_source.
${writable ? `  PRIVATE SECTION.
    METHODS to_base
      IMPORTING
        is_line       TYPE any
      RETURNING
        VALUE(rs_row) TYPE ${e.source.toLowerCase()}.
` : ""}ENDCLASS.

CLASS ${cls} IMPLEMENTATION.

  METHOD zif_stg_cds_source~read.
    DATA lv_where TYPE string.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.

    CREATE DATA rr_data TYPE tt_row.
    ASSIGN rr_data->* TO <lt_data>.

    lv_where = iv_where.
    IF lv_where IS INITIAL.
      lv_where = '1 = 1'.
    ENDIF.

    IF it_fields IS INITIAL.
      SELECT * FROM ${view}
        INTO CORRESPONDING FIELDS OF TABLE <lt_data>
        WHERE (lv_where)
        ORDER BY (it_orderby).
    ELSE.
      SELECT (it_fields) FROM ${view}
        INTO CORRESPONDING FIELDS OF TABLE <lt_data>
        WHERE (lv_where)
        GROUP BY (it_groupby)
        ORDER BY (it_orderby).
    ENDIF.
  ENDMETHOD.

  METHOD zif_stg_cds_source~create_line.
    CREATE DATA rr_line TYPE ty_row.
  ENDMETHOD.

${writeMethods(e)}
ENDCLASS.
`;
}

// The write side of a CDS entity. A projection the view marked writable and
// that maps back to one table field for field is written through to that
// table; anything else keeps SADL's answer, which is that it cannot.
function writeMethods(e) {
  const w = e.write ?? {writable: false, why: "the view does not ask for it"};
  const notImpl = (verb) => `  METHOD zif_stg_cds_source~${verb.toLowerCase()}.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = '${verb} through ${e.name}: ${w.why}'.
  ENDMETHOD.
`;
  if (!w.writable) {
    return [notImpl("INSERT"), notImpl("UPDATE"), notImpl("DELETE")].join("\n");
  }
  const tab = e.source.toLowerCase();
  const mapped = e.fields.filter((f) => !f.virtual && f.base);
  const assign = mapped.map((f) => `    ASSIGN COMPONENT '${f.name}' OF STRUCTURE is_line TO <lv_value>.
    IF sy-subrc = 0.
      rs_row-${f.base.toLowerCase()} = <lv_value>.
    ENDIF.`).join("\n");
  const body = (verb, statement) => (w[verb === "INSERT" ? "creatable" : verb === "UPDATE" ? "updatable" : "deletable"]
    ? `  METHOD zif_stg_cds_source~${verb.toLowerCase()}.
    DATA ls_row TYPE ${tab}.

    ls_row = to_base( is_line ).
${statement}
    rv_subrc = sy-subrc.
  ENDMETHOD.
`
    : notImpl(verb));
  return `  METHOD to_base.
* the row of the view mapped back to the row of the table it projects
    FIELD-SYMBOLS <lv_value> TYPE any.

${w.mandt ? "    rs_row-mandt = sy-mandt.\n" : ""}${assign}
  ENDMETHOD.

${body("INSERT", `    INSERT ${tab} FROM ls_row.`)}
${body("UPDATE", `    UPDATE ${tab} FROM ls_row.`)}
${body("DELETE", `    DELETE FROM ${tab}
      WHERE ${w.keyColumns.map((k) => `${k.toLowerCase()} = ls_row-${k.toLowerCase()}`).join("\n        AND ")}.`)}`;
}

// A DDIC table as a source: what a SEGW project maps an entity to with
// "DDIC~<table>" (DS_TYPE 4). Same interface, static table name, and the
// writes are real: the row type is the table, the keys are inside it.
function tableSourceClass(t) {
  const cls = "zcl_stg_tab_" + t.name.toLowerCase();
  const tab = t.name.toLowerCase();
  return `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/cds2ddic.mjs from table ${t.name} - do not edit
  PUBLIC SECTION.
    INTERFACES zif_stg_cds_source.
ENDCLASS.

CLASS ${cls} IMPLEMENTATION.

  METHOD zif_stg_cds_source~read.
    DATA lv_where TYPE string.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.

    CREATE DATA rr_data TYPE STANDARD TABLE OF ${tab}.
    ASSIGN rr_data->* TO <lt_data>.

    lv_where = iv_where.
    IF lv_where IS INITIAL.
      lv_where = '1 = 1'.
    ENDIF.

    IF it_fields IS INITIAL.
      SELECT * FROM ${tab}
        INTO TABLE <lt_data>
        WHERE (lv_where)
        ORDER BY (it_orderby).
    ELSE.
      SELECT (it_fields) FROM ${tab}
        INTO CORRESPONDING FIELDS OF TABLE <lt_data>
        WHERE (lv_where)
        GROUP BY (it_groupby)
        ORDER BY (it_orderby).
    ENDIF.
  ENDMETHOD.

  METHOD zif_stg_cds_source~create_line.
    CREATE DATA rr_line TYPE ${tab}.
  ENDMETHOD.

  METHOD zif_stg_cds_source~insert.
    DATA ls_row TYPE ${tab}.

    MOVE-CORRESPONDING is_line TO ls_row.
    INSERT ${tab} FROM ls_row.
    rv_subrc = sy-subrc.
  ENDMETHOD.

  METHOD zif_stg_cds_source~update.
    DATA ls_row TYPE ${tab}.

    MOVE-CORRESPONDING is_line TO ls_row.
    UPDATE ${tab} FROM ls_row.
    rv_subrc = sy-subrc.
  ENDMETHOD.

  METHOD zif_stg_cds_source~delete.
* by the primary key, spelled out: DELETE dbtab FROM wa reads as an internal
* table statement to the transpiler
    DATA ls_row TYPE ${tab}.

    MOVE-CORRESPONDING is_line TO ls_row.
    DELETE FROM ${tab}
      WHERE ${t.keyColumns.map((k) => `${k} = ls_row-${k}`).join("\n        AND ")}.
    rv_subrc = sy-subrc.
  ENDMETHOD.

ENDCLASS.
`;
}

// the registry entity of a table: fields and keys from its DDIC definition
function parseTABL(obj, reg) {
  const type = obj.parseType(reg);
  if (!type || type.constructor?.name !== "StructureType") return undefined;
  const keys = new Set((obj.listKeys?.(reg) ?? []).map((k) => k.toUpperCase()));
  const keyColumns = type.getComponents().filter((c) => keys.has(c.name.toUpperCase())).map((c) => c.name.toLowerCase());
  const fields = [];
  for (const c of type.getComponents()) {
    const name = c.name.toUpperCase();
    if (name === "MANDT" || name === "CLIENT") continue;
    if (c.type?.constructor?.name === "StructureType") continue;
    fields.push({name, key: keys.has(name), ...edmOf(c.type), label: name, annotations: []});
  }
  return {name: obj.getName().toUpperCase(), sqlView: obj.getName().toUpperCase(), label: obj.getDescription?.() ?? obj.getName(),
    viewAnnotations: [], fields, associations: [], table: true, keyColumns};
}

function q(s) { return "'" + String(s ?? "").replaceAll("'", "''") + "'"; }
function bt(s) { return "`" + String(s ?? "").replaceAll("`", "``") + "`"; }

// @OData.publish: true on a CDS view is "this view is a service" — on a
// system it generates <view>_CDS with its MPC/DPC and registers it. Here it
// becomes the same model a stg.yaml describes, with the entity bound to the
// view (SADL delegation); stg-compile then writes the tree, the registration
// objects and the classes, exactly as for a hand-written service.
function publishedYaml(e) {
  const service = `${e.name}_CDS`.toUpperCase();
  const lines = [];
  lines.push(`# generated by tools/cds2ddic.mjs from ${e.name} (@OData.publish: true) - do not edit`);
  lines.push(`project: ${service}`);
  lines.push(`service: ${service}`);
  lines.push(`model: ${service}`);
  lines.push(`description: ${JSON.stringify(e.label.slice(0, 60))}`);
  lines.push(`namespace: ${service}`);
  // ZCL_<project>_MPC_EXT would be over 30 characters for most view names;
  // the SQL view name is at most 16 by DDIC rule, so the classes are named
  // after it
  lines.push(`classes: {mpc: ZCL_${e.sqlView}_MPC, mpc_ext: ZCL_${e.sqlView}_MPC_EXT, dpc: ZCL_${e.sqlView}_DPC, dpc_ext: ZCL_${e.sqlView}_DPC_EXT}`);
  lines.push(`entities:`);
  lines.push(`  ${entityName(e)}:`);
  lines.push(`    set: ${entityName(e)}Set`);
  // the model binds to the row of the generated source class, so the virtual
  // elements are part of the structure the DPC hands back
  lines.push(`    source: {cds: ${e.name}, struct: "ZCL_STG_CDS_${e.sqlView}=>TY_ROW"}`);
  lines.push(`    keys: [${e.fields.filter((f) => f.key).map((f) => propertyName(f.name)).join(", ")}]`);
  const w = e.write ?? {};
  lines.push(`    creatable: ${w.creatable === true}`);
  lines.push(`    updatable: ${w.updatable === true}`);
  lines.push(`    deletable: ${w.deletable === true}`);
  const ops = ["R", "Q"];
  if (w.creatable) ops.unshift("C");
  if (w.updatable) ops.push("U");
  if (w.deletable) ops.push("D");
  lines.push(`    operations: [${ops.join(", ")}]`);
  lines.push(`    properties:`);
  for (const f of e.fields) {
    const type = f.edm === "Edm.String" ? `String(${f.maxlength || 40})`
      : f.edm === "Edm.Decimal" ? `"Decimal(${f.precision || 15},${f.scale || 0})"`
      : f.edm === "Edm.DateTime" ? "DateTime"
      : f.edm === "Edm.Int64" ? "Int64"
      : f.edm === "Edm.Time" ? "Time"
      : "Int32";
    const label = JSON.stringify(f.label.slice(0, 60));
    const readonly = f.virtual || !(w.creatable || w.updatable) ? ", readonly: true" : f.key ? ", updatable: false" : "";
    lines.push(`      ${propertyName(f.name)}: {type: ${type}, field: ${f.name}${readonly}, label: ${label}${f.virtual ? ", sortable: false, filterable: false" : ""}}`);
  }
  return lines.join("\n") + "\n";
}

// the OData entity of a CDS view: ZC_STG_TRAVEL -> Zc_Stg_Travel, the way
// SADL names it
function entityName(e) {
  return e.name.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("_");
}

function propertyName(field) {
  return field.toUpperCase();
}

function registryClass(entities) {
  let body = "";
  for (const e of entities) {
    body += `
    CLEAR ls_entity.
    ls_entity-name         = ${q(e.name)}.
    ls_entity-sql_view     = ${q(e.sqlView)}.
    ls_entity-source_class = ${q((e.table ? "ZCL_STG_TAB_" : "ZCL_STG_CDS_") + e.sqlView)}.
    ls_entity-label        = ${bt(e.label)}.
`;
    for (const a of e.viewAnnotations) body += `    APPEND ${bt(a)} TO ls_entity-annotations.\n`;
    for (const f of e.fields) {
      body += `    CLEAR ls_field.
    ls_field-name      = ${q(f.name)}.
    ls_field-is_key    = ${f.key ? "abap_true" : "abap_false"}.
    ls_field-virtual   = ${f.virtual ? "abap_true" : "abap_false"}.
    ls_field-calculated_by = ${q(f.calculatedBy ?? "")}.
    ls_field-edm_type  = ${q(f.edm)}.
    ls_field-maxlength = ${f.maxlength ?? 0}.
    ls_field-precision = ${f.precision ?? 0}.
    ls_field-scale     = ${f.scale ?? 0}.
    ls_field-label     = ${bt(f.label)}.
`;
      for (const a of f.annotations) body += `    APPEND ${bt(a)} TO ls_field-annotations.\n`;
      body += `    APPEND ls_field TO ls_entity-fields.\n`;
    }
    for (const a of e.associations) {
      body += `    CLEAR ls_assoc.
    ls_assoc-name    = ${q(a.alias)}.
    ls_assoc-target  = ${q(a.target)}.
    ls_assoc-min     = ${q(a.min)}.
    ls_assoc-max     = ${q(a.max)}.
    ls_assoc-exposed = ${a.exposed ? "abap_true" : "abap_false"}.
`;
      for (const p of a.pairs) body += `    CLEAR ls_pair.
    ls_pair-source = ${q(p.source)}.
    ls_pair-target = ${q(p.target)}.
    APPEND ls_pair TO ls_assoc-pairs.
`;
      body += `    APPEND ls_assoc TO ls_entity-associations.\n`;
    }
    body += `    APPEND ls_entity TO gt_entities.\n`;
  }
  return `CLASS zcl_stg_cds_registry DEFINITION PUBLIC CREATE PUBLIC.
* generated by tools/cds2ddic.mjs - do not edit. What the SADL exposure and
* DPC know about every CDS entity of this build.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_field,
             name        TYPE string,
             is_key      TYPE abap_bool,
* a virtual element: filled by calculated_by after the read, not by the SELECT
             virtual        TYPE abap_bool,
             calculated_by  TYPE string,
             edm_type    TYPE string,
             maxlength   TYPE i,
             precision   TYPE i,
             scale       TYPE i,
             label       TYPE string,
             annotations TYPE string_table,
           END OF ty_field.
    TYPES tt_field TYPE STANDARD TABLE OF ty_field WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_pair,
             source TYPE string,
             target TYPE string,
           END OF ty_pair.
    TYPES tt_pair TYPE STANDARD TABLE OF ty_pair WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_assoc,
             name    TYPE string,
             target  TYPE string,
             min     TYPE string,
             max     TYPE string,
             exposed TYPE abap_bool,
             pairs   TYPE tt_pair,
           END OF ty_assoc.
    TYPES tt_assoc TYPE STANDARD TABLE OF ty_assoc WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_entity,
             name         TYPE string,
             sql_view     TYPE string,
             source_class TYPE string,
             label        TYPE string,
             annotations  TYPE string_table,
             fields       TYPE tt_field,
             associations TYPE tt_assoc,
           END OF ty_entity.
    TYPES tt_entity TYPE STANDARD TABLE OF ty_entity WITH DEFAULT KEY.

    CLASS-METHODS entities
      RETURNING
        VALUE(rt_entities) TYPE tt_entity.

    CLASS-METHODS get
      IMPORTING
        iv_name          TYPE string
      RETURNING
        VALUE(rs_entity) TYPE ty_entity.
  PRIVATE SECTION.
    CLASS-DATA gt_entities TYPE tt_entity.
    CLASS-METHODS build.
ENDCLASS.

CLASS zcl_stg_cds_registry IMPLEMENTATION.

  METHOD entities.
    IF gt_entities IS INITIAL.
      build( ).
    ENDIF.
    rt_entities = gt_entities.
  ENDMETHOD.

  METHOD get.
    IF gt_entities IS INITIAL.
      build( ).
    ENDIF.
    READ TABLE gt_entities INTO rs_entity WITH KEY name = to_upper( iv_name ).
    IF sy-subrc <> 0.
      CLEAR rs_entity.
    ENDIF.
  ENDMETHOD.

  METHOD build.
    DATA ls_entity TYPE ty_entity.
    DATA ls_field  TYPE ty_field.
    DATA ls_assoc  TYPE ty_assoc.
    DATA ls_pair   TYPE ty_pair.
${body}
  ENDMETHOD.

ENDCLASS.
`;
}

function main() {
  const reg = new abaplint.Registry(new abaplint.Config(JSON.stringify({
    global: {files: "/**/*.*"}, syntax: {version: "open-abap", errorNamespace: "."}, rules: {},
  })));
  const mains = [];
  // every CDS view and every table of the repository, wherever it lives under src/
  mains.push(...walk("src").filter((f) => /\.(ddls\.asddls|ddls\.xml|tabl\.xml|dtel\.xml|doma\.xml|ttyp\.xml)$/.test(f)));
  reg.addFiles(mem(mains));
  reg.addDependencies(mem(LIBS.filter(existsSync).flatMap((l) => walk(l))));
  reg.parse();

  mkdirSync(OUT, {recursive: true});
  const entities = [];
  for (const obj of reg.getObjectsByType("DDLS")) {
    const e = parseDDLS(obj, reg);
    if (!e) continue;
    if (e.skip) { console.log(`cds2ddic: ${e.name}: skipped (${e.skip})`); continue; }
    entities.push(e);
    writeFileSync(join(OUT, e.sqlView.toLowerCase() + ".view.xml"), viewXml(e));
    // on a system the CDS entity name is a type and a select source of its own
    // (SELECT FROM zc_stg_travel, TYPES x TYPE zc_stg_travel); the SQL view is
    // the technical twin. Both exist here, over the same columns.
    if (e.name.toUpperCase() !== e.sqlView.toUpperCase()) {
      writeFileSync(join(OUT, e.name.toLowerCase() + ".view.xml"), viewXml({...e, sqlView: e.name.toUpperCase()}));
    }
    writeFileSync(join(OUT, "zcl_stg_cds_" + e.sqlView.toLowerCase() + ".clas.abap"), sourceClass(e));
    let published = "";
    if (e.viewAnnotations.some((a) => /@OData\.publish:\s*true/i.test(a))) {
      writeFileSync(join(OUT, e.name.toLowerCase() + "_cds.stg.yaml"), publishedYaml(e));
      published = `, published as ${e.name}_CDS`;
    }
    console.log(`cds2ddic: ${e.name} -> ${e.sqlView} (${e.fields.length} fields, ${e.associations.length} associations)${published}`);
  }
  for (const obj of reg.getObjectsByType("TABL")) {
    if (!mains.includes(obj.getFiles()[0].getFilename())) continue; // the repository's own tables, not the libraries'
    const t = parseTABL(obj, reg);
    if (!t) continue;
    entities.push(t);
    writeFileSync(join(OUT, "zcl_stg_tab_" + t.name.toLowerCase() + ".clas.abap"), tableSourceClass(t));
    console.log(`cds2ddic: table ${t.name} (${t.fields.length} fields, keys ${t.fields.filter((f) => f.key).map((f) => f.name).join(",")})`);
  }
  writeFileSync(join(OUT, "zcl_stg_cds_registry.clas.abap"), registryClass(entities));
}
main();
