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
  ddl:"http://www.sap.com/adt/ddic/ddlsources", srvd:"http://www.sap.com/adt/ddic/srvdsources",
  atom:"http://www.w3.org/2005/Atom", xml:"http://www.w3.org/XML/1998/namespace",
};
const knownElements = {
  DATA:"", URI:"", DEVCLASS:"", OPERATION:"", TV_NODEKEY:"",
  objectReferences:"adtcore", objectReference:"adtcore", packageRef:"adtcore",
  checkObjectList:"chkrun", checkObject:"chkrun", content:"chkrun", artifact:"chkrun",
  abap:"asx", values:"asx", virtualFoldersRequest:"vfs", preselection:"vfs", value:"vfs", facetorder:"vfs", facet:"vfs",
  abapClass:"class", abapClassInclude:"class", abapInterface:"intf", abapProgram:"program", abapInclude:"include",
  package:"pack", superPackage:"pack", runConfiguration:"aunit", ddlSource:"ddl", srvdSource:"srvd",
};
const createNamespaces = {
  "oo/classes":"class", "oo/interfaces":"intf", "programs/programs":"program", "programs/includes":"include",
  "ddic/ddl/sources":"ddl", "ddic/srvd/sources":"srvd", packages:"pack",
};
/** Route contract, independent of Content-Type (ADT permits application/*).
 * Empty optional bodies still mean "no keys"/"no lock payload". */
export function requestXMLProfile(method, path) {
  if (String(method).toUpperCase() !== "POST") return undefined;
  path = String(path).split("?")[0].toLowerCase().replace(/\/$/, "").replace(/^\/sap\/bc\/adt\//, "");
  if (path === "activation" || /^abapunit\/testruns(?:\/evaluation)?$/.test(path)) return ["adtcore", "aunit"];
  if (path === "checkruns") return ["chkrun", "adtcore"];
  if (path === "cts/transportchecks" || path === "repository/nodestructure") return ["asx"];
  if (path === "repository/informationsystem/virtualfolders/contents") return ["vfs"];
  if (/^oo\/classes\/[^/]+\/includes$/.test(path)) return ["class"];
  if (createNamespaces[path]) return [createNamespaces[path]];
  if (/^(?:oo\/(?:classes|interfaces)|programs\/(?:programs|includes)|ddic\/(?:ddl|srvd)\/sources|packages)\/[^/]+$/.test(path)) return [];
  return undefined;
}
// Expanded roots audited against vsp crud.go and its SDK objectcreator.ts.
export const objectXMLRoots = {
  CLAS: [namespaces.class, "abapClass"], INTF: [namespaces.intf, "abapInterface"],
  PROG: [namespaces.program, "abapProgram"], INCL: [namespaces.include, "abapInclude"],
  DDLS: [namespaces.ddl, "ddlSource"], SRVD: [namespaces.srvd, "srvdSource"],
};
export function invalidObjectXML(type, body) {
  const expected = objectXMLRoots[type];
  if (!expected) return undefined;
  const root = requestElements(body).find(e => e.parent === 0);
  if (root?.uri === expected[0] && root.local === expected[1]) return undefined;
  const message = `System expected the element '{${expected[0]}}${expected[1]}'`;
  return {message, properties: [["XML_PATH", root ? `${root.local}(1)` : ""],
    ["XML_OFFSET", `${body.length} `], ["T100KEY-ID", "00"], ["T100KEY-NO", "001"],
    ["T100KEY-V1", message.slice(0, 48)], ["T100KEY-V2", message.slice(48)]]};
}

// XML 1.0 fifth-edition NameStartChar/NameChar, with colon excluded
// for namespace NCNames. PI targets also use NCName (Namespaces 1.0).
const startChar = cp => cp === 95 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 ||
  [[0xC0,0xD6],[0xD8,0xF6],[0xF8,0x2FF],[0x370,0x37D],[0x37F,0x1FFF],
    [0x200C,0x200D],[0x2070,0x218F],[0x2C00,0x2FEF],[0x3001,0xD7FF],
    [0xF900,0xFDCF],[0xFDF0,0xFFFD],[0x10000,0xEFFFF]].some(([lo,hi]) => cp >= lo && cp <= hi);
const nameChar = cp => startChar(cp) || cp === 45 || cp === 46 || cp >= 48 && cp <= 57 ||
  cp === 0xB7 || cp >= 0x300 && cp <= 0x36F || cp >= 0x203F && cp <= 0x2040;
const ncName = value => {
  const chars = [...value];
  return chars.length > 0 && startChar(chars[0].codePointAt(0)) && chars.every(c => nameChar(c.codePointAt(0)));
};
function splitName(qname) {
  const pieces = qname.split(":");
  if (pieces.length > 2 || pieces.some(p => !ncName(p))) fail();
  return pieces.length === 1 ? ["",pieces[0]] : pieces;
}
const validChar = cp => cp === 9 || cp === 10 || cp === 13 || cp >= 32 && cp <= 0xD7FF ||
  cp >= 0xE000 && cp <= 0xFFFD || cp >= 0x10000 && cp <= 0x10FFFF;
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
const parsedBodies = new WeakMap();
export const elementsNamed = (elements, uri, local, parent) => elements.filter(e =>
  e.uri === uri && e.local === local && (parent === undefined || e.parent === parent));
export const descendantsOf = (elements, id) => elements.filter(e => {
  let parent=e.parent;
  while (parent !== 0 && parent !== id) parent=elements[parent-1].parent;
  return parent === id;
});
export const attributeValue = (element, uri, local) => element?.attributes.find(a => a.uri === uri && a.local === local)?.value;
export function requestElements(body) {
  if (body?.elements) return body.elements;
  if (!body || body.length === 0) return [];
  return parsedBodies.get(body)?.elements ?? readRequestXML(body).elements;
}
/** Whole-document admission, then a flat expanded-name element table.
 * parent is a one-based element index; text is immediate character data.
 * canonical remains for diagnostics and old public reader tests only. */
export function readRequestXML(body, profile) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
  if (bytes.length > XML_BODY_LIMIT) fail();
  let xml;
  try {xml = new TextDecoder("utf-8",{fatal:true}).decode(bytes);} catch {fail();}
  for (const c of xml) if (!validChar(c.codePointAt(0))) fail();
  xml = xml.replaceAll("\r\n","\n").replaceAll("\r","\n");
  let pos = 0, rootCount = 0;
  // Immutable scope links: no inherited table copy or large-Map set/delete
  // churn for a sibling with one declaration. Lookup follows at most 64 parent links.
  const initialBindings = {local:new Map([["xml",namespaces.xml]])};
  const bindingURI = (scope,prefix) => {
    for (; scope; scope=scope.parent) {
      const uri=scope.local.get(prefix);
      if (uri !== undefined) return uri;
    }
    return "";
  };
  const stack = [], tokens = [], elements = [], unknown = new Map();
  const space = () => {const before=pos; while (/[ \t\r\n]/.test(xml[pos] ?? "") && pos < xml.length) pos++; return pos > before;};
  const scanName = () => {
    const begin = pos;
    while (pos < xml.length) {
      const cp = xml.codePointAt(pos);
      if (cp !== 58 && !nameChar(cp)) break;
      pos += cp > 0xFFFF ? 2 : 1;
    }
    const raw=xml.slice(begin,pos); splitName(raw); return raw;
  };
  const canonical = (uri,local) => {
    if (!uri) return local;
    let prefix = Object.keys(namespaces).find(key => namespaces[key] === uri);
    if (!prefix) {if (!unknown.has(uri)) unknown.set(uri, `u${unknown.size}`); prefix = unknown.get(uri);}
    return `${prefix}:${local}`;
  };
  const expand = (raw,bindings,attribute=false) => {
    const [prefix,local] = splitName(raw);
    if (prefix === "xmlns") fail();
    const uri = bindingURI(bindings,prefix);
    if (prefix && !uri) fail();
    return {uri:!prefix && attribute ? "" : uri,local};
  };
  const text = value => {
    if (!stack.length) {if (/[^ \t\r\n]/.test(value)) fail(); return;}
    elements[stack.at(-1).id-1].text += value; tokens.push(esc(value));
  };
  while (pos < xml.length) {
    if (xml.startsWith("<!--",pos)) {
      const end = xml.indexOf("--",pos+4); if(end < 0 || !xml.startsWith("-->",end)) fail(); pos=end+3; continue;
    }
    if (xml.startsWith("<?",pos)) {
      const begin=pos, end=xml.indexOf("?>",pos+2); if(end < 0) fail();
      pos+=2; const target=scanName(); if(!ncName(target)) fail();
      if (target.toLowerCase() === "xml") {
        const pi=xml.slice(begin+2,end);
        if (begin !== 0 || !/^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(['"])[Uu][Tt][Ff]-8\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(['"])(?:yes|no)\3)?[ \t\r\n]*$/.test(pi)) fail();
      } else if (pos !== end && !space()) fail();
      pos=end+2; continue;
    }
    if (xml.startsWith("<![CDATA[",pos)) {
      const end=xml.indexOf("]]>",pos+9); if(end < 0 || !stack.length) fail();
      text(xml.slice(pos+9,end)); pos=end+3; continue;
    }
    if (xml[pos] !== "<") {
      const end=xml.indexOf("<",pos), raw=xml.slice(pos,end < 0 ? xml.length : end);
      if (raw.includes("]]>")) fail();
      // References are permitted only inside the root, even if they decode to S.
      if (!stack.length && raw.includes("&")) fail();
      text(decode(raw)); pos=end < 0 ? xml.length : end; continue;
    }
    if (xml.startsWith("<!",pos)) fail(); // A declaration, never comment/CDATA text.
    const closing=xml.startsWith("</",pos); pos+=closing ? 2 : 1;
    const raw=scanName();
    if (closing) {
      space(); if(xml[pos++] !== ">" || !stack.length || stack.at(-1).raw !== raw) fail();
      tokens.push(`</${stack.pop().name}>`); continue;
    }
    const attrs=[]; let empty=false;
    while (true) {
      const separated=space();
      if (xml[pos] === ">") {pos++;break;}
      if (xml.startsWith("/>",pos)) {pos+=2;empty=true;break;}
      if (!separated) fail();
      const key=scanName(); space(); if(xml[pos++] !== "=") fail(); space();
      const quote=xml[pos++]; if(quote !== "'" && quote !== '"') fail();
      const end=xml.indexOf(quote,pos); if(end < 0) fail();
      const value=xml.slice(pos,end); if(value.includes("<")) fail();
      attrs.push([key,decode(value.replace(/[\t\n]/g," "))]); pos=end+1;
    }
    if (stack.length >= XML_DEPTH_LIMIT) fail();
    let bindings=stack.at(-1)?.bindings ?? initialBindings, declarations;
    const rawNames=new Set();
    for (const [key,value] of attrs) {
      if(rawNames.has(key)) fail(); rawNames.add(key);
      if (key === "xmlns" || key.startsWith("xmlns:")) {
        const prefix=key === "xmlns" ? "" : key.slice(6); if(prefix && !ncName(prefix)) fail();
        if(prefix === "xmlns" || value === "http://www.w3.org/2000/xmlns/" || (prefix === "xml") !== (value === namespaces.xml) || prefix && !value) fail();
        (declarations ??= new Map()).set(prefix,value);
      }
    }
    if (declarations) bindings={parent:bindings,local:declarations};
    const expanded=expand(raw,bindings);
    if (Object.hasOwn(knownElements,expanded.local) && expanded.uri !== (namespaces[knownElements[expanded.local]] ?? "")) fail();
    if(!stack.length && (++rootCount > 1 || profile?.length && !profile.some(p => namespaces[p] === expanded.uri))) fail();
    const element={...expanded,parent:stack.at(-1)?.id ?? 0,text:"",attributes:[]}, seen=new Set();
    const cname=canonical(expanded.uri,expanded.local); let output=`<${cname}`;
    for (const [key,value] of attrs) {
      if(key === "xmlns" || key.startsWith("xmlns:")) continue;
      const attr=expand(key,bindings,true), id=JSON.stringify([attr.uri,attr.local]);
      if(seen.has(id)) fail(); seen.add(id); element.attributes.push({...attr,value});
      output+=` ${canonical(attr.uri,attr.local)}="${esc(value)}"`;
    }
    elements.push(element); tokens.push(output+">");
    if (empty) tokens.push(`</${cname}>`);
    else stack.push({raw,name:cname,bindings,id:elements.length});
  }
  if(stack.length || rootCount !== 1) fail();
  const result={canonical:tokens.join(""),elements};
  if (Buffer.isBuffer(body)) parsedBodies.set(body,result);
  return result;
}

// Host raw-body parsers reject before the facade runs. Map that rejection
// here so every HTTP host keeps the same 16 MiB ceiling and XML answer.
export function requestXMLBodyError(error, req, res, next) {
  if (error?.type !== "entity.too.large" || requestXMLProfile(req.method, req.originalUrl ?? req.url) === undefined) return next(error);
  res.status(400).type("application/xml").send(exceptionDocument(XML_ERROR_TYPE, XML_ERROR_MESSAGE));
}
import {exceptionDocument} from "./adt-documents.mjs";
