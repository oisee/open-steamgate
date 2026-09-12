// SEGW "Map to Data Source" code: what the DPC base class gets for an
// operation mapped to an RFC / BOR function module (data source type 2) or
// to a search help (type 6). The templates copy what SEGW writes on a 7.40+
// system (/IWBEP/EPM_DEVELOPER_SCENARIO, SEPM_HCM_SCENARIO and
// /IWBEP/GWSAMPLE_BASIC are the oracles, see docs/segw-mapping.md):
//
//   RFC: declare one variable per mapped function module parameter, fill
//   the inputs from the request (keys, entry data, filter ranges, constant
//   values), take the RFC destination from the service configuration, call
//   the module locally or with DESTINATION, run the exception handling and
//   the message log, map the outputs back; creates commit and read back,
//   updates and deletes commit.
//
//   search help: turn the request into a DDSHSELOPS table, call the
//   search-help runtime through /IWBEP/IF_SB_GENDPC_SHLP_DATA, unpivot the
//   field/value result list into the entity structure.
//
// The function module signature comes from an abapGit *.fugr.xml
// (<FUNCTIONS><item>), loaded with loadFunctionGroups(); the property
// mapping rows are /IWBEP/I_SBD_MP (property or constant -> DS_ATT_PATH,
// direction I/O) and /IWBEP/I_SBD_MR (the HIGH/LOW/OPTION/SIGN components
// of a range table).
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

// ---------------------------------------------------------- FUGR signatures

function items(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const f = {};
    for (const x of m[1].matchAll(/<([A-Z_0-9]+)>([^<]*)<\/\1>/g)) {
      f[x[1]] = x[2];
    }
    out.push(f);
  }
  return out;
}

function parameters(block, tag) {
  if (!block) {
    return [];
  }
  // RSIMP/RSEXP/RSCHA: TYP (or DBFIELD for LIKE); RSTBL: TYP or DBSTRUCT
  return items(block, tag).map((r) => ({
    name: r.PARAMETER, type: r.TYP || r.DBFIELD || r.DBSTRUCT || "", optional: r.OPTIONAL === "X", reference: r.REFERENCE === "X",
  }));
}

export function parseFunctionGroup(xml) {
  const out = new Map();
  const funcs = /<FUNCTIONS>([\s\S]*?)<\/FUNCTIONS>/.exec(xml);
  if (funcs === null) {
    return out;
  }
  for (const item of funcs[1].split(/<\/item>\s*<item>|<item>|<\/item>/).filter((s) => /<FUNCNAME>/.test(s))) {
    const name = /<FUNCNAME>([^<]*)<\/FUNCNAME>/.exec(item)[1];
    const section = (tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(item) ?? [])[1];
    out.set(name, {
      name,
      remote: /<REMOTE_CALL>R<\/REMOTE_CALL>/.test(item),
      importing: parameters(section("IMPORT"), "RSIMP"),
      exporting: parameters(section("EXPORT"), "RSEXP"),
      changing: parameters(section("CHANGING"), "RSCHA"),
      tables: parameters(section("TABLES"), "RSTBL"),
    });
  }
  return out;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".git") {
      continue;
    }
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (e.endsWith(".fugr.xml")) {
      out.push(p);
    }
  }
  return out;
}

// every function module of every abapGit function group under the folders
export function loadFunctionGroups(dirs) {
  const all = new Map();
  for (const dir of dirs) {
    for (const file of walk(dir, [])) {
      for (const [name, sig] of parseFunctionGroup(readFileSync(file, "utf8"))) {
        if (!all.has(name)) {
          all.set(name, {...sig, file});
        }
      }
    }
  }
  return all;
}

// --------------------------------------------------------- mapping model

// SEGW copies the DDIC types the module uses into one generated interface
// per module (artifact type BOP): /IWBEP/IF_SEPM_GWS_BP_GET_DE1 for
// SEPM_GWS_BP_GET_DETAIL. The name is IF_ + the module name, cut to 30
// characters with a number where it collides.
// Newer trees say which module an interface belongs to (RFC_NAME); older
// ones only have the name, and a regenerated project keeps the stale
// interfaces in the list, so the last match is the current one.
export function bopInterface(fm, artifacts) {
  const bops = artifacts.filter((a) => a.GEN_ART_TYPE === "BOP");
  const byModule = bops.filter((a) => a.RFC_NAME === fm);
  if (byModule.length > 0) {
    return byModule[byModule.length - 1].NAME;
  }
  const byStem = bops.filter((a) => {
    const stem = a.NAME.replace(/^\/[^/]+\//, "").replace(/^IF_/, "").replace(/\d+$/, "");
    return fm.startsWith(stem) || stem.startsWith(fm);
  });
  return byStem.length > 0 ? byStem[byStem.length - 1].NAME : "";
}

const lc = (s) => s.toLowerCase();
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

// what a parameter is when the signature does not say: SAP naming
const kindByName = (name) => (/^I[VST]_|^I_/.test(name) ? "importing" : /^E[VST]_|^E_/.test(name) ? "exporting" : /^C[VST]_|^C_/.test(name) ? "changing" : "tables");
const shapeByName = (name) => (/^[IEC]T_|^T_/.test(name) ? "table" : /^[IEC]S_|^S_/.test(name) ? "structure" : "scalar");

// one variable per function module parameter the mapping touches
function usedParameters(mapping, sig) {
  const params = new Map();
  const add = (path) => {
    const [root] = path.split("\\");
    if (params.has(root)) {
      return params.get(root);
    }
    const p = {name: root, kind: "", type: "", shape: shapeByName(root), constants: [], props: [], ranges: []};
    if (sig) {
      for (const kind of ["importing", "exporting", "changing", "tables"]) {
        const found = sig[kind].find((x) => x.name === root);
        if (found) {
          p.kind = kind;
          p.type = found.type;
        }
      }
    }
    if (!p.kind) {
      p.kind = kindByName(root);
    }
    params.set(root, p);
    return p;
  };
  for (const mp of mapping.props) {
    const p = add(mp.dsAttPath);
    const component = mp.dsAttPath.includes("\\") ? mp.dsAttPath.split("\\")[1] : "";
    if (component || mapping.ranges.some((r) => r.mpUuid === mp.uuid)) {
      if (p.shape === "scalar") {
        p.shape = "structure";
      }
    }
    const ranges = mapping.ranges.filter((r) => r.mpUuid === mp.uuid);
    if (ranges.length > 0) {
      p.shape = "table";
      p.ranges.push({...mp, components: ranges});
    } else if (mp.constant !== undefined) {
      p.constants.push({component, value: mp.constant});
    } else {
      p.props.push({...mp, component});
    }
  }
  if (mapping.logAttr) {
    const p = add(mapping.logAttr);
    p.shape = "table";
    p.isLog = true;
  }
  return [...params.values()];
}

function typeOf(p, intf) {
  if (!p.type) {
    return "";
  }
  return intf ? `${lc(intf)}=>${lc(p.type)}` : lc(p.type);
}

// CALL FUNCTION ... EXPORTING/IMPORTING/TABLES/CHANGING blocks, names aligned
function callBlocks(params, indent, width) {
  const groups = [["importing", "EXPORTING"], ["exporting", "IMPORTING"], ["tables", "TABLES"], ["changing", "CHANGING"]];
  let s = "";
  for (const [kind, keyword] of groups) {
    const list = params.filter((p) => p.kind === kind);
    if (list.length === 0) {
      continue;
    }
    s += `${indent}${keyword}\n`;
    for (const p of list) {
      s += `${indent}  ${pad(lc(p.name), width)} = ${lc(p.name)}\n`;
    }
  }
  return s;
}

function callFunction(params) {
  const width = Math.max(21, ...params.map((p) => p.name.length));
  const w1 = Math.max(14, ...params.map((p) => p.name.length));
  return ` IF lv_destination IS INITIAL OR lv_destination EQ 'NONE'.

   TRY.
       CALL FUNCTION lv_rfc_name
${callBlocks(params, "         ", w1)}         EXCEPTIONS
           ${pad("system_failure", w1)} = 1000  MESSAGE lv_exc_msg
           ${pad("OTHERS", w1)} = 1002.

       lv_subrc = sy-subrc.
*in case of co-deployment the exception is raised and needs to be caught
     CATCH cx_root INTO lx_root.
       lv_subrc = 1001.
       lv_exc_msg = lx_root->if_message~get_text( ).
   ENDTRY.

 ELSE.

   CALL FUNCTION lv_rfc_name DESTINATION lv_destination
${callBlocks(params, "     ", width)}     EXCEPTIONS
       ${pad("system_failure", width)} = 1000  MESSAGE lv_exc_msg
       ${pad("communication_failure", width)} = 1001  MESSAGE lv_exc_msg
       ${pad("OTHERS", width)} = 1002.

   lv_subrc = sy-subrc.

 ENDIF.
`;
}

const ERROR_HANDLING = `*-------------------------------------------------------------
*  Map the RFC response to the caller interface - Only mapped attributes
*-------------------------------------------------------------
*-------------------------------------------------------------
* Error and exception handling
*-------------------------------------------------------------
 IF lv_subrc <> 0.
* Execute the RFC exception handling process
   me->/iwbep/if_sb_dpc_comm_services~rfc_exception_handling(
     EXPORTING
       iv_subrc            = lv_subrc
       iv_exp_message_text = lv_exc_msg ).
 ENDIF.
`;

const saveLog = (logAttr) => (logAttr ? `
 IF ${lc(logAttr)} IS NOT INITIAL.
   me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(
     EXPORTING
       iv_entity_type = iv_entity_name
       it_return      = ${lc(logAttr)}
       it_key_tab     = it_key_tab ).
 ENDIF.
` : "");

const COMMIT = `
* Call RFC commit work
 me->/iwbep/if_sb_dpc_comm_services~commit_work(
        EXPORTING
          iv_rfc_dest = lv_destination
     ) .
`;

const GET_DESTINATION = `
* Get RFC destination
 lo_dp_facade = /iwbep/if_mgw_conv_srv_runtime~get_dp_facade( ).
 lv_destination = /iwbep/cl_sb_gen_dpc_rt_util=>get_rfc_destination( io_dp_facade = lo_dp_facade ).

*-------------------------------------------------------------
*  Call RFC function module
*-------------------------------------------------------------
`;

const REQUEST_BANNER = `*-------------------------------------------------------------
*  Map the runtime request to the RFC - Only mapped attributes
*-------------------------------------------------------------
* Get all input information from the technical request context object
* Since DPC works with internal property names and runtime API interface holds external property names
* the process needs to get the all needed input information from the technical request context object
`;

// the target of an input mapping / the source of an output mapping
const paramPath = (p, component, viaLine) => (component ? `${viaLine ? "ls_" : ""}${lc(p.name)}-${lc(component)}` : lc(p.name));

function constantLines(params) {
  let s = "";
  const withConstants = params.filter((p) => p.constants.length > 0);
  if (withConstants.length > 0) {
    s += "\n* Maps constant value to function module parameters\n";
    for (const p of withConstants) {
      for (const c of p.constants) {
        s += ` ${paramPath(p, c.component, p.shape === "table")} = ${c.value}.\n`;
      }
    }
  }
  return s;
}

function appendConstantLines(params) {
  const tables = params.filter((p) => p.shape === "table" && p.constants.length > 0);
  if (tables.length === 0) {
    return "";
  }
  return "\n* Append lines of table parameters in the function call\n" + tables.map((p) => ` IF ls_${lc(p.name)} IS NOT INITIAL.
   APPEND ls_${lc(p.name)} TO ${lc(p.name)}.
 ENDIF.
`).join("");
}

function declarations(params, intf, extra) {
  const lines = [];
  const mapped = params.filter((p) => !p.isLog && (p.props.length > 0 || p.ranges.length > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const log = params.filter((p) => p.isLog);
  const constantOnly = params.filter((p) => !p.isLog && p.props.length === 0 && p.ranges.length === 0).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...mapped, ...log, ...constantOnly];
  for (const p of ordered) {
    lines.push(` DATA ${lc(p.name)}${p.shape === "table" ? " " : ""} TYPE ${typeOf(p, intf)}.`);
  }
  for (const p of ordered.filter((x) => x.shape === "table")) {
    lines.push(intf ? ` DATA ls_${lc(p.name)}  TYPE LINE OF ${typeOf(p, intf)}.` : ` DATA ls_${lc(p.name)}  LIKE LINE OF ${lc(p.name)}.`);
  }
  lines.push(" DATA lv_rfc_name TYPE tfdir-funcname.", " DATA lv_destination TYPE rfcdest.", " DATA lv_subrc TYPE syst-subrc.",
    " DATA lv_exc_msg TYPE /iwbep/mgw_bop_rfc_excep_text.", " DATA lx_root TYPE REF TO cx_root.", ...extra,
    " DATA lo_dp_facade TYPE REF TO /iwbep/if_mgw_dp_facade.");
  return lines.join("\n") + "\n";
}

const keyLines = (params, entity, source) => {
  let s = "";
  for (const p of params) {
    for (const mp of p.props.filter((x) => x.direction === "I" && entity.properties.find((pr) => pr.name === x.property)?.isKey)) {
      const pr = entity.properties.find((x) => x.name === mp.property);
      s += ` ${paramPath(p, mp.component)} = ${source}-${lc(pr.abapField)}.\n`;
    }
  }
  return s;
};

const inputLines = (params, entity, keysToo) => {
  let s = "";
  for (const p of params) {
    for (const mp of p.props.filter((x) => x.direction === "I")) {
      const pr = entity.properties.find((x) => x.name === mp.property);
      if (!pr || (!keysToo && pr.isKey)) {
        continue;
      }
      s += ` ${paramPath(p, mp.component)} = ls_request_input_data-${lc(pr.abapField)}.\n`;
    }
  }
  return s;
};

// the entity sets that navigate into this entity and hand over the key
// property through a referential constraint (the source of the keys when the
// operation runs behind a navigation property)
function sourceSets(m, entity, prop) {
  const out = [];
  for (const a of m.associations) {
    if (a.rightType !== entity.name) {
      continue;
    }
    for (const c of a.constraints.filter((x) => x.dependent === prop.name)) {
      const left = m.entityTypes.find((e) => e.name === a.leftType);
      if (!left) {
        continue;
      }
      const principal = left.properties.find((x) => x.name === c.principal);
      for (const es of left.entitySets) {
        out.push({set: es.name, entity: left, field: principal?.abapField ?? c.principal});
      }
    }
  }
  return out;
}

// RFC mapping for one operation; returns the method body or "" when the
// signature is unknown and nothing sensible can be written
export function rfcMethod(op, m, opts) {
  const mapping = op.mapping;
  const sig = opts.functionModules?.get(mapping.functionName);
  const intf = bopInterface(mapping.functionName, m.artifacts);
  const params = usedParameters(mapping, sig);
  // no signature, no types: the BOP interface only says where the types
  // live, not what they are called
  if (params.some((p) => !p.type)) {
    return "";
  }
  const entity = op.entity;
  const mpc = lc(m.classes.mpc);
  const ts = `${mpc}=>ts_${lc(entity.typeStem)}`;
  const outputs = params.flatMap((p) => p.props.filter((x) => x.direction === "O").map((x) => ({...x, param: p})));
  let s = `  method ${op.method}.\n*-------------------------------------------------------------\n*  Data declaration\n*-------------------------------------------------------------\n`;
  let body = "";
  switch (op.type) {
    case "R": {
      s += declarations(params, intf, [" DATA ls_converted_keys LIKE er_entity.", " DATA lv_source_entity_set_name TYPE string."]);
      body += `
${REQUEST_BANNER}* Get key table information - for direct call
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values = ls_converted_keys ).
${constantLines(params)}
* Maps key fields to function module parameters

 lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).
`;
      const keyInputs = params.flatMap((p) => p.props.filter((x) => x.direction === "I").map((x) => ({...x, param: p, pr: entity.properties.find((y) => y.name === x.property)}))).filter((x) => x.pr);
      const sources = [...new Set(keyInputs.flatMap((i) => sourceSets(m, entity, i.pr).map((x) => x.set)))];
      for (const src of sources) {
        body += ` IF lv_source_entity_set_name = '${src}' AND
    lv_source_entity_set_name NE io_tech_request_context->get_entity_set_name( ).
   io_tech_request_context->get_converted_source_keys(
   IMPORTING es_key_values = ls_converted_keys ).
 ENDIF.
`;
      }
      for (const i of keyInputs) {
        body += ` ${paramPath(i.param, i.component)} = ls_converted_keys-${lc(i.pr.abapField)}.\n`;
      }
      body += `${appendConstantLines(params)}${GET_DESTINATION} lv_rfc_name = '${mapping.functionName}'.

${callFunction(params)}
${ERROR_HANDLING}${saveLog(mapping.logAttr)}
*-------------------------------------------------------------------------*
*             - Post Backend Call -
*-------------------------------------------------------------------------*
* Map properties from the backend to the Gateway output response structure

`;
      for (const o of outputs) {
        const pr = entity.properties.find((x) => x.name === o.property);
        if (!pr) {
          continue;
        }
        if (o.param.shape === "table") {
          body += ` READ TABLE ${lc(o.param.name)} INTO ls_${lc(o.param.name)} INDEX 1.\n er_entity-${lc(pr.abapField)} = ls_${lc(o.param.name)}-${lc(o.component)}.\n`;
        } else {
          body += ` er_entity-${lc(pr.abapField)} = ${paramPath(o.param, o.component)}.\n`;
        }
      }
      break;
    }
    case "Q": {
      const outTable = outputs.find((o) => o.param.shape === "table")?.param;
      const scalarInputs = params.flatMap((p) => p.props.filter((x) => x.direction === "I").map((x) => ({...x, param: p, pr: entity.properties.find((y) => y.name === x.property)}))).filter((x) => x.pr);
      const rangeInputs = params.flatMap((p) => p.ranges.map((r) => ({...r, param: p, pr: entity.properties.find((y) => y.name === r.property)}))).filter((x) => x.pr);
      const navSources = scalarInputs.flatMap((i) => sourceSets(m, entity, i.pr).map((src) => ({...src, input: i})));
      const sourceVars = [...new Map(navSources.map((x) => [x.entity.name, x.entity])).values()];
      const filtered = [...scalarInputs, ...rangeInputs];
      s += declarations(params, intf, [" DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.", " DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.",
        " DATA lv_filter_str TYPE string.", " DATA ls_paging TYPE /iwbep/s_mgw_paging.", " DATA ls_converted_keys LIKE LINE OF et_entityset.",
        ...(navSources.length > 0 ? [" DATA lv_source_entity_set_name TYPE string."] : []),
        ...sourceVars.map((e) => ` DATA ${lc(e.techName)}_get_entityset TYPE LINE OF ${mpc}=>tt_${lc(e.typeStem)}.`),
        " DATA ls_filter TYPE /iwbep/s_mgw_select_option.", " DATA ls_filter_range TYPE /iwbep/s_cod_select_option.",
        ...filtered.map((i) => ` DATA lr_${lc(i.pr.abapField)} LIKE RANGE OF ls_converted_keys-${lc(i.pr.abapField)}.\n DATA ls_${lc(i.pr.abapField)} LIKE LINE OF lr_${lc(i.pr.abapField)}.`),
        ...(outTable ? [` DATA ls_gw_${lc(outTable.name)} LIKE LINE OF et_entityset.`] : []), " DATA lv_skip     TYPE int4.", " DATA lv_top      TYPE int4."]);
      body += `
${REQUEST_BANNER}* Get filter or select option information
 lo_filter = io_tech_request_context->get_filter( ).
 lt_filter_select_options = lo_filter->get_filter_select_options( ).
 lv_filter_str = lo_filter->get_filter_string( ).

* Check if the supplied filter is supported by standard gateway runtime process
 IF  lv_filter_str            IS NOT INITIAL
 AND lt_filter_select_options IS INITIAL.
   " If the string of the Filter System Query Option is not automatically converted into
   " filter option table (lt_filter_select_options), then the filtering combination is not supported
   " Log message in the application log
   me->/iwbep/if_sb_dpc_comm_services~log_message(
     EXPORTING
       iv_msg_type   = 'E'
       iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
       iv_msg_number = 025 ).
   " Raise Exception
   RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
     EXPORTING
       textid = /iwbep/cx_mgw_tech_exception=>internal_error.
 ENDIF.

* Get key table information
 io_tech_request_context->get_converted_source_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).

 ls_paging-top = io_tech_request_context->get_top( ).
 ls_paging-skip = io_tech_request_context->get_skip( ).
${constantLines(params)}`;
      if (navSources.length > 0) {
        body += "\n* Maps key fields to function module parameters\n IF it_key_tab IS NOT INITIAL.\n   lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).\n";
        for (const src of navSources) {
          body += `   IF  lv_source_entity_set_name = '${src.set}'.
     " Convert keys to appropriate entity set structure
     io_tech_request_context->get_converted_source_keys(
       IMPORTING
         es_key_values  = ${lc(src.entity.techName)}_get_entityset ).
     ${paramPath(src.input.param, src.input.component)} = ${lc(src.entity.techName)}_get_entityset-${lc(src.field)}.
   ENDIF.
`;
        }
        body += " ENDIF.\n";
      }
      if (filtered.length > 0) {
        body += "\n IF it_filter_select_options IS NOT INITIAL.\n* Maps filter table lines to function module parameters\n   LOOP AT lt_filter_select_options INTO ls_filter.\n\n     LOOP AT ls_filter-select_options INTO ls_filter_range.\n       CASE ls_filter-property.\n";
        for (const i of filtered) {
          const f = lc(i.pr.abapField);
          body += `         WHEN '${i.pr.abapField.toUpperCase()}'.              " Equivalent to '${i.property}' property in the service
           lo_filter->convert_select_option(
             EXPORTING
               is_select_option = ls_filter
             IMPORTING
               et_select_option = lr_${f} ).
`;
          if (i.components) {
            const sem = {H: "high", L: "low", O: "option", S: "sign"};
            body += `           LOOP AT lr_${f} INTO ls_${f}.\n`;
            for (const c of [...i.components].sort((a, b) => a.semantics.localeCompare(b.semantics))) {
              body += `             ls_${lc(i.param.name)}-${lc(c.component)} = ls_${f}-${sem[c.semantics] ?? lc(c.component)}.\n`;
            }
            body += `             APPEND ls_${lc(i.param.name)} TO ${lc(i.param.name)}.\n           ENDLOOP.\n`;
          } else {
            body += `           READ TABLE lr_${f} INTO ls_${f} INDEX 1.\n           IF sy-subrc = 0.\n             ${paramPath(i.param, i.component)} = ls_${f}-low.\n           ENDIF.\n`;
          }
        }
        body += `         WHEN OTHERS.
           " Log message in the application log
           me->/iwbep/if_sb_dpc_comm_services~log_message(
             EXPORTING
               iv_msg_type   = 'E'
               iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
               iv_msg_number = 020
               iv_msg_v1     = ls_filter-property ).
           " Raise Exception
           RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
             EXPORTING
               textid = /iwbep/cx_mgw_tech_exception=>internal_error.
       ENDCASE.
     ENDLOOP.

   ENDLOOP.
 ENDIF.
`;
      }
      body += `${appendConstantLines(params)}${GET_DESTINATION} lv_rfc_name = '${mapping.functionName}'.

${callFunction(params)}
${ERROR_HANDLING}${saveLog(mapping.logAttr)}
*-------------------------------------------------------------------------*
*             - Post Backend Call -
*-------------------------------------------------------------------------*
`;
      if (outTable) {
        body += ` IF ls_paging-skip IS NOT INITIAL.
*  If the Skip value was requested at runtime
*  the response table will provide backend entries from skip + 1, meaning start from skip +1
*  for example: skip=5 means to start get results from the 6th row
   lv_skip = ls_paging-skip + 1.
 ENDIF.
*  The Top value was requested at runtime but was not handled as part of the function interface
 IF  ls_paging-top <> 0
 AND lv_skip IS NOT INITIAL.
*  if lv_skip > 0 retrieve the entries from lv_skip + Top - 1
*  for example: skip=5 and top=2 means to start get results from the 6th row and end in row number 7
   lv_top = ls_paging-top + lv_skip - 1.
 ELSEIF ls_paging-top <> 0
 AND    lv_skip IS INITIAL.
   lv_top = ls_paging-top.
 ELSE.
   lv_top = LINES( ${lc(outTable.name)} ).
 ENDIF.

*  - Map properties from the backend to the Gateway output response table -

 LOOP AT ${lc(outTable.name)} INTO ls_${lc(outTable.name)}
*  Provide the response entries according to the Top and Skip parameters that were provided at runtime
      FROM lv_skip TO lv_top.
*  Only fields that were mapped will be delivered to the response table
`;
        for (const o of outputs.filter((x) => x.param === outTable)) {
          const pr = entity.properties.find((x) => x.name === o.property);
          if (pr) {
            body += `   ls_gw_${lc(outTable.name)}-${lc(pr.abapField)} = ls_${lc(outTable.name)}-${lc(o.component)}.\n`;
          }
        }
        body += `   APPEND ls_gw_${lc(outTable.name)} TO et_entityset.
   CLEAR ls_gw_${lc(outTable.name)}.
 ENDLOOP.
`;
      }
      break;
    }
    case "C": {
      s += declarations(params, intf, [` DATA ls_request_input_data TYPE ${ts}.`, " DATA ls_entity TYPE REF TO data.", " DATA lo_tech_read_request_context TYPE REF TO /iwbep/cl_sb_gen_read_aftr_crt.",
        " DATA ls_key TYPE /iwbep/s_mgw_tech_pair.", " DATA lt_keys TYPE /iwbep/t_mgw_tech_pairs.", " DATA lv_entityset_name TYPE string.",
        " DATA lv_entity_name TYPE string.", " FIELD-SYMBOLS: <ls_data> TYPE ANY.", " DATA ls_converted_keys LIKE er_entity."]);
      body += `
${REQUEST_BANNER}* Get request input data
 io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).
${constantLines(params)}
* Map request input fields to function module parameters
${inputLines(params, entity, true)}${appendConstantLines(params)}${GET_DESTINATION} lv_rfc_name = '${mapping.functionName}'.

${callFunction(params)}
${ERROR_HANDLING}${saveLog(mapping.logAttr)}${COMMIT}*-------------------------------------------------------------------------*
*             - Read After Create -
*-------------------------------------------------------------------------*
 CREATE OBJECT lo_tech_read_request_context.

* Create key table for the read operation

`;
      for (const pr of entity.properties.filter((x) => x.isKey)) {
        const o = outputs.find((x) => x.property === pr.name);
        const value = o ? (o.param.shape === "table" ? `ls_${lc(o.param.name)}-${lc(o.component)}` : paramPath(o.param, o.component)) : `ls_request_input_data-${lc(pr.abapField)}`;
        body += ` ls_key-name = '${pr.abapField.toUpperCase()}'.
 ls_key-value = ${value}.
 IF ls_key-value IS NOT INITIAL.
   APPEND ls_key TO lt_keys.
 ENDIF.

`;
      }
      body += `* Set into request context object the key table and the entity set name
 lo_tech_read_request_context->set_keys( EXPORTING  it_keys = lt_keys ).
 lv_entityset_name = io_tech_request_context->get_entity_set_name( ).
 lo_tech_read_request_context->set_entityset_name( EXPORTING iv_entityset_name = lv_entityset_name ).
 lv_entity_name = io_tech_request_context->get_entity_type_name( ).
 lo_tech_read_request_context->set_entity_type_name( EXPORTING iv_entity_name = lv_entity_name ).

* Call read after create
 /iwbep/if_mgw_appl_srv_runtime~get_entity(
   EXPORTING
     iv_entity_name     = iv_entity_name
     iv_entity_set_name = iv_entity_set_name
     iv_source_name     = iv_source_name
     it_key_tab         = it_key_tab
     io_tech_request_context = lo_tech_read_request_context
     it_navigation_path = it_navigation_path
   IMPORTING
     er_entity          = ls_entity ).

* Send the read response to the caller interface
 ASSIGN ls_entity->* TO <ls_data>.
 er_entity = <ls_data>.
`;
      break;
    }
    case "U": {
      s += declarations(params, intf, [` DATA ls_request_input_data TYPE ${ts}.`, " DATA ls_converted_keys LIKE er_entity.", " DATA lv_source_entity_set_name TYPE string."]);
      body += `
${REQUEST_BANNER}* Get request input data
 io_data_provider->read_entry_data( IMPORTING es_data = ls_request_input_data ).
* Get key table information
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).
${constantLines(params)}
* Maps key fields to function module parameters

${keyLines(params, entity, "ls_converted_keys")}* Map request input fields to function module parameters
${inputLines(params, entity, false)}${appendConstantLines(params)}${GET_DESTINATION} lv_rfc_name = '${mapping.functionName}'.

${callFunction(params)}
${ERROR_HANDLING}${saveLog(mapping.logAttr)}${COMMIT}`;
      break;
    }
    case "D": {
      s += declarations(params, intf, [` DATA ls_converted_keys TYPE ${ts}.`, " DATA lv_source_entity_set_name TYPE string."]);
      body += `
${REQUEST_BANNER}* Get key table information
 io_tech_request_context->get_converted_keys(
   IMPORTING
     es_key_values  = ls_converted_keys ).
${constantLines(params)}
* Maps key fields to function module parameters

${keyLines(params, entity, "ls_converted_keys")}${appendConstantLines(params)}${GET_DESTINATION} lv_rfc_name = '${mapping.functionName}'.

${callFunction(params)}
${ERROR_HANDLING}${saveLog(mapping.logAttr)}${COMMIT}`;
      break;
    }
    default:
      return "";
  }
  return s + body + "  endmethod.\n";
}

// ------------------------------------------------------------ search help

export const SHLP_INTERFACE = "/IWBEP/IF_SB_GENDPC_SHLP_DATA";

export const SHLP_IMPLEMENTATION = `  method /IWBEP/IF_SB_GENDPC_SHLP_DATA~GET_SEARCH_HELP_VALUES.
* Call to Search Help run time mechanism to get values
  DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.

  CLEAR: et_return_list, es_message.
  lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).

  lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
    EXPORTING
      iv_shlp_name  = iv_shlp_name
      iv_maxrows  = iv_maxrows
      iv_sort = iv_sort
      iv_call_shlt_exit = iv_call_shlt_exit
      it_selopt = it_selopt
    IMPORTING
      et_return_list = et_return_list
      es_message = es_message ).
  endmethod.
`;

const shlpResultCase = (outputs, entity, target) => {
  let s = "";
  for (const o of outputs) {
    const pr = entity.properties.find((x) => x.name === o.property);
    if (pr) {
      s += `    WHEN '${o.component.toUpperCase()}'.\n      ${target}-${lc(pr.abapField)} = ls_result_list-field_value.\n`;
    }
  }
  return s;
};

export function shlpMethod(op, m) {
  const mapping = op.mapping;
  const entity = op.entity;
  const shlp = mapping.shlpName;
  const inputs = mapping.props.filter((x) => x.direction === "I");
  const outputs = mapping.props.filter((x) => x.direction === "O").map((x) => ({...x, component: x.dsAttPath.split("\\").pop()}));
  if (op.type === "Q") {
    const ranges = inputs.map((i) => ({...i, pr: entity.properties.find((x) => x.name === i.property)})).filter((i) => i.pr);
    return `  method ${op.method}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
DATA lo_filter TYPE  REF TO /iwbep/if_mgw_req_filter.
DATA lt_filter_select_options TYPE /iwbep/t_mgw_select_option.
DATA lv_filter_str TYPE string.
DATA lv_max_hits TYPE i.
DATA ls_paging TYPE /iwbep/s_mgw_paging.
DATA ls_converted_keys LIKE LINE OF et_entityset.
DATA ls_message TYPE bapiret2.
DATA lt_selopt TYPE ddshselops.
DATA ls_selopt LIKE LINE OF lt_selopt.
${ranges.length > 0 ? "DATA ls_filter TYPE /iwbep/s_mgw_select_option.\nDATA ls_filter_range TYPE /iwbep/s_cod_select_option.\n" : ""}${ranges.map((i) => `DATA lr_${lc(i.pr.abapField)} LIKE RANGE OF ls_converted_keys-${lc(i.pr.abapField)}.\nDATA ls_${lc(i.pr.abapField)} LIKE LINE OF lr_${lc(i.pr.abapField)}.\n`).join("")}DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.
DATA lv_next TYPE i VALUE 1.
DATA ls_entityset LIKE LINE OF et_entityset.
DATA ls_result_list_next LIKE LINE OF lt_result_list.
DATA ls_result_list LIKE LINE OF lt_result_list.

*-------------------------------------------------------------
*  Map the runtime request to the Search Help select option - Only mapped attributes
*-------------------------------------------------------------
* Get all input information from the technical request context object
* Since DPC works with internal property names and runtime API interface holds external property names
* the process needs to get the all needed input information from the technical request context object
* Get filter or select option information
lo_filter = io_tech_request_context->get_filter( ).
lt_filter_select_options = lo_filter->get_filter_select_options( ).
lv_filter_str = lo_filter->get_filter_string( ).

* Check if the supplied filter is supported by standard gateway runtime process
IF  lv_filter_str            IS NOT INITIAL
AND lt_filter_select_options IS INITIAL.
  " If the string of the Filter System Query Option is not automatically converted into
  " filter option table (lt_filter_select_options), then the filtering combination is not supported
  " Log message in the application log
  me->/iwbep/if_sb_dpc_comm_services~log_message(
    EXPORTING
      iv_msg_type   = 'E'
      iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
      iv_msg_number = 025 ).
  " Raise Exception
  RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
    EXPORTING
      textid = /iwbep/cx_mgw_tech_exception=>internal_error.
ENDIF.

* Get key table information
io_tech_request_context->get_converted_source_keys(
  IMPORTING
    es_key_values  = ls_converted_keys ).

ls_paging-top = io_tech_request_context->get_top( ).
ls_paging-skip = io_tech_request_context->get_skip( ).

" Calculate the number of max hits to be fetched from the function module
" The lv_max_hits value is a summary of the Top and Skip values
IF ls_paging-top > 0.
  lv_max_hits = is_paging-top + is_paging-skip.
ENDIF.

${ranges.length === 0 ? "" : `* Maps filter table lines to the Search Help select option table
LOOP AT lt_filter_select_options INTO ls_filter.

  CASE ls_filter-property.
${ranges.map((i) => `    WHEN '${i.pr.abapField.toUpperCase()}'.              " Equivalent to '${i.property}' property in the service
      lo_filter->convert_select_option(
        EXPORTING
          is_select_option = ls_filter
        IMPORTING
          et_select_option = lr_${lc(i.pr.abapField)} ).

      LOOP AT lr_${lc(i.pr.abapField)} INTO ls_${lc(i.pr.abapField)}.
        ls_selopt-high = ls_${lc(i.pr.abapField)}-high.
        ls_selopt-low = ls_${lc(i.pr.abapField)}-low.
        ls_selopt-option = ls_${lc(i.pr.abapField)}-option.
        ls_selopt-sign = ls_${lc(i.pr.abapField)}-sign.
        ls_selopt-shlpfield = '${i.dsAttPath.toUpperCase()}'.
        ls_selopt-shlpname = '${shlp}'.
        APPEND ls_selopt TO lt_selopt.
        CLEAR ls_selopt.
      ENDLOOP.
`).join("")}
    WHEN OTHERS.
      " Log message in the application log
      me->/iwbep/if_sb_dpc_comm_services~log_message(
        EXPORTING
          iv_msg_type   = 'E'
          iv_msg_id     = '/IWBEP/MC_SB_DPC_ADM'
          iv_msg_number = 020
          iv_msg_v1     = ls_filter-property ).
      " Raise Exception
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_tech_exception
        EXPORTING
          textid = /iwbep/cx_mgw_tech_exception=>internal_error.
  ENDCASE.
ENDLOOP.
`}
*-------------------------------------------------------------
*  Call to Search Help get values mechanism
*-------------------------------------------------------------
* Get search help values
me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
  EXPORTING
    iv_shlp_name = '${shlp}'
    iv_maxrows = lv_max_hits
    iv_sort = 'X'
    iv_call_shlt_exit = 'X'
    it_selopt = lt_selopt
  IMPORTING
    et_return_list = lt_result_list
    es_message = ls_message ).

*-------------------------------------------------------------
*  Map the Search Help returned results to the caller interface - Only mapped attributes
*-------------------------------------------------------------
IF ls_message IS NOT INITIAL.
* Call RFC call exception handling
  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(
    EXPORTING
      is_return      = ls_message
      iv_entity_type = iv_entity_name
      it_key_tab     = it_key_tab ).
ENDIF.

CLEAR et_entityset.

LOOP AT lt_result_list INTO ls_result_list
  WHERE record_number > ls_paging-skip.

  " Move SH results to GW request responce table
  lv_next = sy-tabix + 1. " next loop iteration
  CASE ls_result_list-field_name.
${shlpResultCase(outputs, entity, "ls_entityset")}  ENDCASE.

  " Check if the next line in the result list is a new record
  READ TABLE lt_result_list INTO ls_result_list_next INDEX lv_next.
  IF sy-subrc <> 0
  OR ls_result_list-record_number <> ls_result_list_next-record_number.
    " Save the collected SH result in the GW request table
    APPEND ls_entityset TO et_entityset.
    CLEAR: ls_result_list_next, ls_entityset.
  ENDIF.

ENDLOOP.

  endmethod.
`;
  }
  if (op.type === "R") {
    const keys = inputs.map((i) => ({...i, pr: entity.properties.find((x) => x.name === i.property)})).filter((i) => i.pr);
    return `  method ${op.method}.
*-------------------------------------------------------------
*  Data declaration
*-------------------------------------------------------------
DATA lv_max_hits TYPE i VALUE 1.
DATA ls_converted_keys LIKE er_entity.
DATA ls_message TYPE bapiret2.
DATA lt_selopt TYPE ddshselops.
DATA ls_selopt LIKE LINE OF lt_selopt.
DATA lv_source_entity_set_name TYPE string.
DATA lt_result_list TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.
DATA ls_result_list LIKE LINE OF lt_result_list.

*-------------------------------------------------------------
*  Map the runtime request to the Search Help select option - Only mapped attributes
*-------------------------------------------------------------
* Get all input information from the technical request context object
* Since DPC works with internal property names and runtime API interface holds external property names
* the process needs to get the all needed input information from the technical request context object
* Get key table information - for direct call
io_tech_request_context->get_converted_keys(
  IMPORTING
    es_key_values = ls_converted_keys ).

* Maps key fields to function module parameters

lv_source_entity_set_name = io_tech_request_context->get_source_entity_set_name( ).

${keys.map((i) => `ls_selopt-sign = 'I'.
ls_selopt-option = 'EQ'.
ls_selopt-low = ls_converted_keys-${lc(i.pr.abapField)}.
ls_selopt-shlpfield = '${i.dsAttPath.toUpperCase()}'.
ls_selopt-shlpname = '${shlp}'.
APPEND ls_selopt TO lt_selopt.
CLEAR ls_selopt.
`).join("\n")}
*-------------------------------------------------------------
*  Call to Search Help get values mechanism
*-------------------------------------------------------------
* Get search help values
me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
  EXPORTING
    iv_shlp_name = '${shlp}'
    iv_maxrows = lv_max_hits
    iv_sort = 'X'
    iv_call_shlt_exit = 'X'
    it_selopt = lt_selopt
  IMPORTING
    et_return_list = lt_result_list
    es_message = ls_message ).

*-------------------------------------------------------------
*  Map the Search Help returned results to the caller interface - Only mapped attributes
*-------------------------------------------------------------
IF ls_message IS NOT INITIAL.
* Call RFC call exception handling
  me->/iwbep/if_sb_dpc_comm_services~rfc_save_log(
    EXPORTING
      is_return      = ls_message
      iv_entity_type = iv_entity_name
      it_key_tab     = it_key_tab ).
ENDIF.

CLEAR er_entity.
LOOP AT lt_result_list INTO ls_result_list.

  " Move SH results to GW request responce table
  CASE ls_result_list-field_name.
${shlpResultCase(outputs, entity, "er_entity")}  ENDCASE.

ENDLOOP.

  endmethod.
`;
  }
  return "";
}
