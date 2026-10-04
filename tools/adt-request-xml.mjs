// Request XML policy, shared by every Node ADT host. No DTD or resolver.
// Canonical names are an internal adapter for the existing document readers;
// they are selected ONLY from expanded names, never from the client's prefix.
export const XML_BODY_LIMIT = 16 * 1024 * 1024;
export const XML_DEPTH_LIMIT = 64;
export const XML_ERROR_TYPE = "ExceptionInvalidXML"; // Our clean-room type id.
export const XML_ERROR_MESSAGE = "invalid XML request";
export class RequestXMLError extends Error {
  constructor() { super(XML_ERROR_MESSAGE); this.code = XML_ERROR_TYPE; }
}
const fail = () => {throw new RequestXMLError();};
export const namespaces = {
  adtcore:"http://www.sap.com/adt/core", chkrun:"http://www.sap.com/adt/checkrun",
  asx:"http://www.sap.com/abapxml", vfs:"http://www.sap.com/adt/ris/virtualFolders",
  class:"http://www.sap.com/adt/oo/classes", intf:"http://www.sap.com/adt/oo/interfaces",
  program:"http://www.sap.com/adt/programs/programs", include:"http://www.sap.com/adt/programs/includes",
  pack:"http://www.sap.com/adt/packages", aunit:"http://www.sap.com/adt/aunit",
  ddl:"http://www.sap.com/adt/ddic/ddlsources", srvd:"http://www.sap.com/adt/ddic/srvd",
  atom:"http://www.w3.org/2005/Atom", xml:"http://www.w3.org/XML/1998/namespace",
};
const knownElements = {
  DATA:"", URI:"", DEVCLASS:"", OPERATION:"", TV_NODEKEY:"",
  objectReferences:"adtcore", objectReference:"adtcore", packageRef:"adtcore",
  checkObjectList:"chkrun", checkObject:"chkrun", content:"chkrun", artifact:"chkrun",
  abap:"asx", values:"asx", virtualFoldersRequest:"vfs", preselection:"vfs", value:"vfs", facetorder:"vfs", facet:"vfs",
  abapClass:"class", abapClassInclude:"class", abapInterface:"intf", abapProgram:"program", abapInclude:"include",
  package:"pack", superPackage:"pack", runConfiguration:"aunit", ddlSource:"ddl", serviceDefinition:"srvd",
};
const createNamespaces = {
  "oo/classes":"class", "oo/interfaces":"intf", "programs/programs":"program", "programs/includes":"include",
  "ddic/ddl/sources":"ddl", "ddic/srvd/sources":"srvd", packages:"pack",
};
/** Route contract, independent of Content-Type (ADT permits application/*).
 * Empty optional bodies still mean "no keys"/"no lock payload". */
export function requestXMLProfile(method, path) {
  if (String(method).toUpperCase() !== "POST") return undefined;
  path = String(path).split("?")[0].replace(/\/$/, "").replace(/^\/sap\/bc\/adt\//, "").toLowerCase();
  if (path === "activation" || /^abapunit\/testruns(?:\/evaluation)?$/.test(path)) return ["adtcore", "aunit"];
  if (path === "checkruns") return ["chkrun", "adtcore"];
  if (path === "cts/transportchecks" || path === "repository/nodestructure") return ["asx"];
  if (path === "repository/informationsystem/virtualfolders/contents") return ["vfs"];
  if (/^oo\/classes\/[^/]+\/includes$/.test(path)) return ["class"];
  if (createNamespaces[path]) return [createNamespaces[path]];
  if (/^(?:oo\/(?:classes|interfaces)|programs\/(?:programs|includes)|ddic\/(?:ddl|srvd)\/sources|packages)\/[^/]+$/.test(path)) return [];
  return undefined;
}
const namePattern = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_.\-\u0080-\uFFFF]*$/;
function splitName(qname) {
  const pieces = qname.split(":");
  if (pieces.length > 2 || pieces.some(p => !namePattern.test(p))) fail();
  return pieces.length === 1 ? ["", pieces[0]] : pieces;
}
const validChar = cp => cp === 9 || cp === 10 || cp === 13 || (cp >= 32 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
function decode(raw) {
  if (raw.replace(/&(?:amp|lt|gt|apos|quot|#[0-9]+|#x[0-9a-fA-F]+);/g, "").includes("&")) fail();
  return raw.replace(/&([^;]+);/g, (_, entity) => {
    const builtins = {amp:"&",lt:"<",gt:">",apos:"'",quot:'"'};
    if (builtins[entity] !== undefined) return builtins[entity];
    const cp = entity[1] === "x" ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    if (!validChar(cp)) fail(); return String.fromCodePoint(cp);
  });
}
const esc = value => value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
/** Parse the whole document before returning ANY data. A flat token stream
 * avoids recursion even for a hostile document beyond the depth limit. */
export function readRequestXML(body, profile) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  if (bytes.length > XML_BODY_LIMIT) fail();
  let xml;
  try {xml = new TextDecoder("utf-8",{fatal:true}).decode(bytes);} catch {fail();}
  if (/<!DOCTYPE/i.test(xml)) fail();
  for (const c of xml) if (!validChar(c.codePointAt(0))) fail();
  if (!xml.trim()) fail();
  xml = xml.replaceAll("\r\n","\n").replaceAll("\r","\n");
  let pos = 0, rootCount = 0;
  const stack = [], tokens = [], unknown = new Map();
  const canonical = (uri,local) => {
    if (!uri) return local;
    let prefix = Object.keys(namespaces).find(key => namespaces[key] === uri);
    if (!prefix) {if (!unknown.has(uri)) unknown.set(uri, `u${unknown.size}`); prefix = unknown.get(uri);}
    return `${prefix}:${local}`;
  };
  const expand = (raw,bindings,attribute=false) => {
    const [prefix,local] = splitName(raw);
    const uri = bindings.get(prefix) ?? "";
    if (prefix && !uri) fail();
    return {uri:!prefix && attribute ? "" : uri,local};
  };
  while (pos < xml.length) {
    if (xml.startsWith("<!--",pos)) {
      const end = xml.indexOf("--",pos+4);if(end < 0 || !xml.startsWith("-->",end)) fail(); pos=end+3;continue;
    }
    if (xml.startsWith("<?",pos)) {
      const end = xml.indexOf("?>",pos+2);if(end < 0) fail();
      const pi = xml.slice(pos+2,end);
      if (/^xml(?:\s|$)/i.test(pi) && (pos !== 0 || !/^xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])UTF-8\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*$/i.test(pi))) fail();
      pos=end+2;continue;
    }
    if (xml.startsWith("<![CDATA[",pos)) {
      const end = xml.indexOf("]]>",pos+9);if(end < 0 || !stack.length) fail();
      const value=xml.slice(pos+9,end);tokens.push(esc(value));pos=end+3;continue;
    }
    if (xml[pos] !== "<") {
      const end = xml.indexOf("<",pos);const raw=xml.slice(pos,end < 0 ? xml.length : end);
      if (raw.includes("]]>")) fail();const value=decode(raw);
      if (!stack.length && value.trim()) fail();
      if(stack.length) tokens.push(esc(value));
      pos=end < 0 ? xml.length : end;continue;
    }
    const closing = xml.startsWith("</",pos);
    const name = /^([^\s/<>]+)[\s]*/.exec(xml.slice(pos+(closing ? 2 : 1)))?.[1];if(!name) fail();
    pos += (closing ? 2 : 1)+name.length;
    if(closing) {
      const end=/^\s*>/.exec(xml.slice(pos));if(!end || !stack.length || stack.at(-1).raw!==name) fail();
      tokens.push(`</${stack.pop().name}>`);pos+=end[0].length;continue;
    }
    const attrs=[];
    while(pos < xml.length) {
      const tail=xml.slice(pos);
      const end=/^\s*(\/?>)/.exec(tail);if(end) {pos+=end[0].length;break;}
      const a=/^\s+([^\s=<>/]+)\s*=\s*(['"])([^]*?)\2/.exec(tail);if(!a || a[3].includes("<")) fail();
      attrs.push([a[1],decode(a[3].replace(/[\t\n]/g," "))]);pos+=a[0].length;
    }
    if (pos > xml.length || xml[pos-1] !== ">") fail();
    if(stack.length >= XML_DEPTH_LIMIT) fail();
    const bindings=new Map(stack.at(-1)?.bindings ?? [["xml",namespaces.xml]]);
    const rawNames=new Set();
    for(const [key,value] of attrs) {
      if(rawNames.has(key)) fail();rawNames.add(key);
      if(key === "xmlns" || key.startsWith("xmlns:")) {
        const prefix=key === "xmlns" ? "" : key.slice(6); if(prefix) splitName(prefix);
        if(prefix === "xmlns" || value === "http://www.w3.org/2000/xmlns/" || (prefix === "xml") !== (value === namespaces.xml) || (prefix && !value)) fail();
        bindings.set(prefix,value);
      }
    }
    const expanded=expand(name,bindings);
    if (Object.hasOwn(knownElements,expanded.local) && expanded.uri !== (namespaces[knownElements[expanded.local]] ?? "")) fail();
    if(!stack.length) {if(++rootCount > 1 || (profile?.length && !profile.some(p => namespaces[p] === expanded.uri))) fail();}
    const seen=new Set();let output=`<${canonical(expanded.uri,expanded.local)}`;
    for(const [key,value] of attrs) {
      if(key === "xmlns" || key.startsWith("xmlns:")) continue;
      const attr=expand(key,bindings,true); const id=JSON.stringify([attr.uri,attr.local]);if(seen.has(id)) fail();seen.add(id);
      output+=` ${canonical(attr.uri,attr.local)}="${esc(value)}"`;
    }
    tokens.push(output+">");
    const cname=canonical(expanded.uri,expanded.local);
    if(xml[pos-2] === "/") tokens.push(`</${cname}>`);
    else stack.push({raw:name,name:cname,bindings});
  }
  if(stack.length || rootCount !== 1) fail();
  return {canonical:tokens.join("")};
}

// Host raw-body parsers reject before the facade runs. Map that rejection
// here so every HTTP host keeps the same 16 MiB ceiling and XML answer.
export function requestXMLBodyError(error, req, res, next) {
  if (error?.type !== "entity.too.large" || requestXMLProfile(req.method, req.originalUrl ?? req.url) === undefined) return next(error);
  res.status(400).type("application/xml").send(exceptionDocument(XML_ERROR_TYPE, XML_ERROR_MESSAGE));
}
import {exceptionDocument} from "./adt-documents.mjs";
