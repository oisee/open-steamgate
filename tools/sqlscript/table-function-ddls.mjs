// A CDS table function, read off its DDLS source: the signature an AMDP
// method declared `FOR TABLE FUNCTION x` does not carry itself.
//
//   define table function P_X
//     with parameters
//       @Environment.systemField: #CLIENT
//       p_clnt : mandt,
//       p_guid : zde_uuid
//   returns {
//     key mandt : mandt;
//         value : abap.char(10);
//   }
//   implemented by method cl_x=>get_x
//
// Two halves and both matter: the parameters are the scalar inputs the body
// binds (`:p_clnt`), and the RETURNS list is the output schema a **caller**
// needs when this function appears in somebody else's FROM. Both are kept
// as ABAP type text -- `mandt`, `abap.char(10)` -- and typed later by
// scalar-types.mjs with whatever dictionary the run has, so this reader
// knows no dictionary and invents no type.
//
// `@Environment.systemField: #CLIENT` is recorded as `systemField` and
// nothing more: which client a portable run binds there is a runtime
// decision with a measured trap behind it (sy-mandt is 123 here and 001 on
// A4H), and it is not made by a parser.
import {stripComments} from "../ddls-entity.mjs";

/** the text inside the first `{ ... }` from `at`, braces matched by depth */
function braced(text, at) {
  const open = text.indexOf("{", at);
  if (open < 0) return undefined;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
}
/** split on commas or semicolons that are not inside parentheses */
function splitTopLevel(text, separator) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === "(" || ch === "{" || ch === "[")) depth += 1;
    if (!quoted && (ch === ")" || ch === "}" || ch === "]")) depth -= 1;
    if (ch === separator && depth === 0 && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((one) => one.trim()).filter((one) => one !== "");
}

/** one `@A.b: #X @C: true name : type` entry into {name, abapType, annotations} */
function entry(text) {
  const annotations = {};
  let rest = text;
  for (;;) {
    // a value is #ENUM, true, a number, a 'quoted text with spaces', an
    // [ array ] or a { record }; the first form is the only one read here
    const m = /^@([\w.]+)\s*:\s*('[^']*'|\[[^\]]*\]|\{[^}]*\}|[^\s@,;]+)\s*/.exec(rest);
    if (m === null) break;
    annotations[m[1].toUpperCase()] = m[2].replace(/^'|'$/g, "");
    rest = rest.slice(m[0].length);
  }
  const key = /^key\s+/i.test(rest);
  rest = rest.replace(/^key\s+/i, "");
  const m = /^([\w\/]+)\s*:\s*(.+)$/s.exec(rest.trim());
  if (m === null) return undefined;
  return {name: m[1], abapType: m[2].replace(/\s+/g, " ").trim(), key, annotations};
}

/**
 * @returns {{name, parameters: [{name, direction, abapType, systemField?}], returns: [{name, abapType, key}], implementedBy?: {class, method}} | undefined}
 *   undefined when the source is not a table function
 */
export function parseTableFunction(source) {
  const text = stripComments(String(source));
  const head = /define\s+table\s+function\s+([\w\/]+)/i.exec(text);
  if (head === null) return undefined;
  const after = text.slice(head.index + head[0].length);
  const returnsAt = after.search(/\breturns\b/i);
  if (returnsAt < 0) throw new Error(`table function ${head[1]}: no RETURNS`);
  const parameters = [];
  const withParams = /with\s+parameters([\s\S]*)/i.exec(after.slice(0, returnsAt));
  if (withParams !== null) {
    for (const one of splitTopLevel(withParams[1], ",")) {
      const p = entry(one);
      if (p === undefined) throw new Error(`table function ${head[1]}: cannot read parameter "${one.trim()}"`);
      const systemField = p.annotations["ENVIRONMENT.SYSTEMFIELD"];
      parameters.push({name: p.name, direction: "IN", abapType: p.abapType,
        ...(systemField === undefined ? {} : {systemField: systemField.replace(/^#/, "").toUpperCase()})});
    }
  }
  const body = braced(after, returnsAt);
  if (body === undefined) throw new Error(`table function ${head[1]}: RETURNS without a { } list`);
  const returns = [];
  for (const one of splitTopLevel(body, ";")) {
    const column = entry(one);
    if (column === undefined) throw new Error(`table function ${head[1]}: cannot read column "${one.trim()}"`);
    returns.push({name: column.name, abapType: column.abapType, key: column.key});
  }
  const impl = /implemented\s+by\s+method\s+([\w\/]+)\s*=>\s*([\w]+)/i.exec(after.slice(returnsAt));
  return {
    name: head[1].toUpperCase(),
    parameters,
    returns,
    ...(impl === null ? {} : {implementedBy: {class: impl[1].toUpperCase(), method: impl[2].toUpperCase()}}),
  };
}
