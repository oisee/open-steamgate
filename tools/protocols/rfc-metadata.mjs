// SPDX-License-Identifier: MIT
// The small DDIC surface a fresh Eclipse workspace needs before ADT-over-RFC.
import {encodeRfcCutResponse, encodeUtf16le} from "./rfc.mjs";

function abapChar(value, width) {
  return encodeUtf16le(value, width);
}

function importText(request, name) {
  const value = request.imports.get(name);
  if (!value || value.length & 1) return "";
  let text = value.toString("utf16le").trimEnd();
  if (/^[A-Z0-9_]*$/.test(text)) return text;
  const swapped = Buffer.from(value);
  for (let at = 0; at < swapped.length; at += 2) [swapped[at], swapped[at + 1]] = [swapped[at + 1], swapped[at]];
  text = swapped.toString("utf16le").trimEnd();
  return /^[A-Z0-9_]*$/.test(text) ? text : "";
}

function funintRow({parameterClass, parameterName, tableName, exid, internalLength, parameterText}) {
  const ints = Buffer.alloc(16);
  ints.writeUInt32LE(internalLength, 8);
  const row = Buffer.concat([
    abapChar(parameterClass, 1),
    abapChar(parameterName, 30),
    abapChar(tableName, 30),
    abapChar("", 30),
    abapChar(exid, 1),
    ints,
    abapChar("", 21),
    abapChar(parameterText, 79),
    abapChar("", 1),
  ]);
  if (row.length !== 402) throw new Error("RFC_FUNINT row geometry changed");
  return row;
}

const DFIES_LAYOUT = [
  ["TABNAME",30],["FIELDNAME",30],["LANGU",1],["POSITION",4,1],["OFFSET",6,1],["DOMNAME",30],["ROLLNAME",30],["CHECKTABLE",30],
  ["LENG",6,1],["INTLEN",6,1],["OUTPUTLEN",6,1],["DECIMALS",6,1],["DATATYPE",4],["INTTYPE",1],["REFTABLE",30],["REFFIELD",30],
  ["PRECFIELD",30],["AUTHORID",3],["MEMORYID",20],["LOGFLAG",1],["MASK",20],["MASKLEN",4,1],["CONVEXIT",5],["HEADLEN",2,1],
  ["SCRLEN1",2,1],["SCRLEN2",2,1],["SCRLEN3",2,1],["FIELDTEXT",60],["REPTEXT",55],["SCRTEXT_S",10],["SCRTEXT_M",20],
  ["SCRTEXT_L",40],["KEYFLAG",1],["LOWERCASE",1],["MAC",1],["GENKEY",1],["NOFORKEY",1],["VALEXI",1],["NOAUTHCH",1],["SIGN",1],
  ["DYNPFLD",1],["F4AVAILABL",1],["COMPTYPE",1],["LFIELDNAME",132],["LTRFLDDIS",1],["BIDICTRLC",1],["OUTPUTSTYLE",2,1],
  ["NOHISTORY",1],["AMPMFORMAT",1],
];

const scalar = (name, position, offset, owner, datatype = "STRG", inttype = "g", length = 0) => ({name, position, offset, rollname: "", length, intlen: 8, datatype, inttype, precfield: owner, comptype: "", lfieldname: name, language: "E", dynpro: true, noAuth: true});
const line = (name, fields) => ({name, kind: "INTTAB", length: 24, fields: fields.map((field, index) => scalar(field, index + 1, index * 8, name, field === "STATUS_CODE" ? "SSTR" : "STRG", "g", field === "STATUS_CODE" ? 3 : 0))});
const rest = (name, lineName, lineField, fields) => ({name, kind: "INTTAB", length: 40, lineOf: ["IHTTPNVP", "IHTTPNVP_TAB"], fields: [
  {name: lineField, position: 1, offset: 0, rollname: lineName, intlen: 24, datatype: "STRU", inttype: "v", comptype: "S", lfieldname: lineField},
  ...fields.map((field, index) => ({...scalar(field, index + 2, index * 8, lineName, field === "STATUS_CODE" ? "SSTR" : "STRG", "g", field === "STATUS_CODE" ? 3 : 0), lfieldname: `${lineField}-${field}`})),
  {name: "HEADER_FIELDS", position: 5, offset: 24, rollname: "IHTTPNVP_TAB", intlen: 8, datatype: "TTYP", inttype: "h", comptype: "L", lfieldname: "HEADER_FIELDS"},
  {...scalar("MESSAGE_BODY", 6, 32, name, "RSTR", "y"), intlen: 8, noAuth: false},
]});
const DDIC = new Map([
  rest("SADT_REST_REQUEST", "SADT_REST_REQUEST_LINE", "REQUEST_LINE", ["METHOD","URI","VERSION"]),
  rest("SADT_REST_RESPONSE", "SADT_REST_STATUS_LINE", "STATUS_LINE", ["VERSION","STATUS_CODE","REASON_PHRASE"]),
  line("SADT_REST_REQUEST_LINE", ["METHOD","URI","VERSION"]), line("SADT_REST_STATUS_LINE", ["VERSION","STATUS_CODE","REASON_PHRASE"]),
  {name:"IHTTPNVP",kind:"INTTAB",length:16,fields:[
    {...scalar("NAME",1,0,"IHTTPNVP"),rollname:"IHTTPNAM",comptype:"E",texts:["HTTP header name","Name","Name","Name","Name"],headlen:"04",scrlen:["10","15","20"]},
    {...scalar("VALUE",2,8,"IHTTPNVP"),rollname:"IHTTPVAL",comptype:"E",texts:["HTTP header value","Value","Value","Value","Value"],headlen:"10",scrlen:["10","15","20"]},
  ]},
  {name:"IHTTPNVP_TAB",kind:"TTYP",length:16,rowtype:"IHTTPNVP",authorid:"TKN",fields:[{name:"",position:1,offset:0,rollname:"IHTTPNVP",intlen:16,datatype:"STRU",inttype:"",comptype:"T",lfieldname:""}]},
].map((type) => [type.name, type]));

function dfiesValues(typeName, field, authorid = "") {
  const texts = field.texts ?? [];
  const values = field ? {TABNAME:typeName,FIELDNAME:field.name,LANGU:field.language ?? "",POSITION:String(field.position),OFFSET:String(field.offset),ROLLNAME:field.rollname,LENG:String(field.length ?? 0),INTLEN:String(field.intlen ?? 0),DATATYPE:field.datatype,INTTYPE:field.inttype,PRECFIELD:field.precfield,AUTHORID:authorid,HEADLEN:field.headlen,SCRLEN1:field.scrlen?.[0],SCRLEN2:field.scrlen?.[1],SCRLEN3:field.scrlen?.[2],FIELDTEXT:texts[0],REPTEXT:texts[1],SCRTEXT_S:texts[2],SCRTEXT_M:texts[3],SCRTEXT_L:texts[4],NOAUTHCH:field.noAuth ? "X" : "",DYNPFLD:field.dynpro ? "X" : "",COMPTYPE:field.comptype,LFIELDNAME:field.lfieldname} : {};
  return values;
}

function dfiesRow(typeName, field, authorid = "") {
  const values = dfiesValues(typeName, field, authorid);
  const row = Buffer.concat(DFIES_LAYOUT.map(([name,width,numc]) => abapChar(numc ? String(values[name] || "0").padStart(width,"0") : values[name] || "", width)));
  if (row.length !== 1350) throw new Error("DFIES row geometry changed");
  return row;
}

function xmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function dfiesXml(typeName, field, authorid = "") {
  const values = dfiesValues(typeName, field, authorid);
  return `<item>${DFIES_LAYOUT.map(([name,width,numc]) => {
    const value = numc ? String(values[name] || "0").padStart(width, "0") : values[name] || "";
    return `<${name}>${xmlEscape(value)}</${name}>`;
  }).join("")}</item>`;
}

function linesDescr(type) {
  const items = (type.lineOf ?? []).map((name) => {
    const nested = DDIC.get(name);
    if (!nested) throw new Error(`missing nested DDIC type ${name}`);
    const kind = nested.kind === "TTYP" ? "TTYP" : "STRU";
    const fields = nested.fields.map((field) => dfiesXml(nested.name, field, nested.authorid)).join("");
    return `<item><TYPENAME>${nested.name}</TYPENAME><TYPEKIND>${kind}</TYPEKIND><FIELDS>${fields}</FIELDS></item>`;
  }).join("");
  return `<LINES_DESCR>${items}</LINES_DESCR>`;
}

export function functionInterfaceResponse(request) {
  if (importText(request, "FUNCNAME") !== "SADT_REST_RFC_ENDPOINT") throw new Error("FU_NOT_FOUND");
  const wants = new Set(request.requestedOutputs);
  const exports = [
    ["REMOTE_BASXML_SUPPORTED", "X"],
    ["REMOTE_CALL", "R"],
    ["UPDATE_TASK", ""],
  ].filter(([name]) => wants.has(name)).map(([name, value]) => ({name, value: abapChar(value, 1)}));
  const rows = [
    funintRow({parameterClass: "E", parameterName: "RESPONSE", tableName: "SADT_REST_RESPONSE", exid: "v", internalLength: 40, parameterText: "ADT response"}),
    funintRow({parameterClass: "I", parameterName: "REQUEST", tableName: "SADT_REST_REQUEST", exid: "v", internalLength: 40, parameterText: "ADT request"}),
  ];
  const tables = [];
  const requestedTable = (name) => request.tables?.find((table) => table.name === name);
  if (wants.has("PARAMS") || requestedTable("PARAMS")) tables.push({name: "PARAMS", id: requestedTable("PARAMS")?.id, rowLength: 402, rows});
  if (wants.has("RESUMABLE_EXCEPTIONS") || requestedTable("RESUMABLE_EXCEPTIONS")) tables.push({name: "RESUMABLE_EXCEPTIONS", id: requestedTable("RESUMABLE_EXCEPTIONS")?.id, rowLength: 0, rows: []});
  return encodeRfcCutResponse({requestedOutputs: exports.map((value) => value.name), exports, tables, eclipse: request.eclipse, sessionGUID: request.sessionGUID});
}

export function fieldInfoResponse(request) {
  const name = importText(request, "TABNAME");
  const type = DDIC.get(name);
  if (!type) throw new Error("NOT_FOUND");
  const wants = new Set(request.requestedOutputs);
  const exports = wants.has("DDOBJTYPE") ? [{name:"DDOBJTYPE",value:abapChar(type.kind,8)}] : [];
  // JCo asks for ALL_TYPES=X while resolving the SADT structures. Some JCo
  // request variants do not repeat LINES_DESCR as a plain 0x0205 output, but
  // still require this closure before accepting the function template.
  const allTypes = importText(request, "ALL_TYPES") === "X";
  const includeLines = (wants.has("LINES_DESCR") || allTypes) && type.lineOf?.length;
  const xrfc = includeLines ? [{name:"LINES_DESCR",value:Buffer.from(linesDescr(type), "utf8")}] : [];
  const requested = request.tables?.find((table) => table.name === "DFIES_TAB");
  const tables = requested ? [{name:"DFIES_TAB",id:requested.id,rowLength:1350,rows:type.fields.map((field)=>dfiesRow(name,field,type.authorid))}] : [];
  const requestedOutputs = [...exports.map((item)=>item.name), ...(includeLines ? ["LINES_DESCR"] : [])];
  return encodeRfcCutResponse({requestedOutputs,exports,tables,xrfc,eclipse:request.eclipse,sessionGUID:request.sessionGUID});
}
