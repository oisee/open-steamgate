#!/usr/bin/env node
// DSL L2: a rule written in the terms of a domain, compiled to an L1 model,
// rendered to ABAP through ZCL_OSD_TPL and proven by its own examples
// (docs/dsl-l2.md). This file knows the rule language and the DDIC; it knows
// nothing of any one domain -- the tables, fields and words come from the rule.
//
//   node tools/dsl-l2.mjs build <rule.l2.yaml> --out <dir> [--ddic <folder>]...
//   node tools/dsl-l2.mjs check <rule.l2.yaml> --out <dir> [--ddic <folder>]...
//
// The YAML is read by js-yaml (the reader tools/stg-compile.mjs uses) with its
// FAILSAFE schema, so every scalar stays the text written (a key `0012` is not
// the number 12). js-yaml keeps no positions, so a small line index over the
// file's own text gives each key and list item its line (`lineIndex`).
import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import yaml from "js-yaml";
import {DEFAULT_DDIC, DDIC_PROVIDER, Refusal, registryFor} from "./dsl-ddic.mjs";

export const CHECK_TEMPLATE = "recipes/l2-check/template.tpl";
export const TEST_TEMPLATE = "recipes/l2-check-test/template.tpl";

export class RuleError extends Error {
  constructor(file, line, message) {
    super(`${file}:${line}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

// ---------------------------------------------------------------------------
// where each key and list item of the YAML is written

// A path is the keys and 0-based item indexes joined by "/", as
// `forbid/where` or `examples/1/rows/ZTAB/0/field`. Block mappings and block
// sequences are indexed; a flow collection (`[{a: 1}]`) is one line, so what
// is inside it takes the line of the key that holds it (see `lineOf`).
export function lineIndex(text) {
  const index = new Map();
  const stack = [{indent: -1, path: ""}];
  let scalarIndent = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (scalarIndent >= 0) {
      if (content === "" || indent > scalarIndent) return;
      scalarIndent = -1;
    }
    if (content === "" || content.startsWith("#") || content === "---") return;
    let column = indent;
    let rest = raw.slice(indent);
    while (rest === "-" || rest.startsWith("- ")) {
      while (stack.at(-1).indent > column || (stack.at(-1).indent === column && stack.at(-1).item)) stack.pop();
      const parent = stack.at(-1);
      parent.count = parent.itemIndent === column ? parent.count + 1 : 0;
      parent.itemIndent = column;
      const path = `${parent.path}/${parent.count}`;
      if (!index.has(path)) index.set(path, line);
      stack.push({indent: column, path, item: true});
      const after = rest.slice(1);
      const skip = after.length - after.trimStart().length;
      column += 1 + skip;
      rest = after.trimStart();
    }
    const key = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#{[\]}:,][^:#]*?)\s*:(?:\s|$)/.exec(rest);
    if (!key) return;
    const name = key[1].startsWith('"') || key[1].startsWith("'") ? key[1].slice(1, -1) : key[1].trim();
    while (stack.at(-1).indent >= column) stack.pop();
    const path = `${stack.at(-1).path}/${name}`;
    if (!index.has(path)) index.set(path, line);
    stack.push({indent: column, path});
    if (/^[|>][-+0-9]*\s*(#.*)?$/.test(rest.slice(key[0].length).trim())) scalarIndent = column;
  });
  return index;
}

// the line of a path, or of the nearest enclosing path that has one
function lineOf(index, path) {
  let current = `/${path}`;
  while (current) {
    if (index.has(current)) return index.get(current);
    current = current.slice(0, current.lastIndexOf("/"));
  }
  return 1;
}

// ---------------------------------------------------------------------------
// expressions: a tokenizer and a recursive-descent parser

const OPERATORS = ["<>", "<=", ">=", "=", "<", ">"];

export function tokenize(text, fail) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (c === "'") {
      let value = "";
      i++;
      for (;;) {
        if (i >= text.length) fail(`unterminated literal at column ${start + 1}`);
        if (text[i] === "'") {
          if (text[i + 1] === "'") { value += "'"; i += 2; continue; }
          i++;
          break;
        }
        value += text[i++];
      }
      tokens.push({kind: "string", value, column: start + 1});
    } else if (/[0-9-]/.test(c) && /^-?[0-9]/.test(text.slice(i, i + 2))) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(text.slice(i));
      i += m[0].length;
      tokens.push({kind: "number", value: m[0], column: start + 1});
    } else if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
      if (!m) fail(`a parameter needs a name after $ at column ${start + 1}`);
      i += m[0].length;
      tokens.push({kind: "param", value: m[1].toLowerCase(), column: start + 1});
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      i += m[0].length;
      tokens.push({kind: "ident", value: m[0], column: start + 1});
    } else if (c === ".") {
      i++;
      tokens.push({kind: "dot", value: ".", column: start + 1});
    } else {
      const op = OPERATORS.find((o) => text.startsWith(o, i));
      if (!op) fail(`unexpected character ${JSON.stringify(c)} at column ${start + 1}`);
      i += op.length;
      tokens.push({kind: "op", value: op, column: start + 1});
    }
  }
  tokens.push({kind: "end", value: "", column: text.length + 1});
  return tokens;
}

class Parser {
  constructor(text, fail) {
    this.fail = fail;
    this.tokens = tokenize(text, fail);
    this.at = 0;
  }
  peek() { return this.tokens[this.at]; }
  next() { return this.tokens[this.at++]; }
  describe(token) { return token.kind === "end" ? "the end" : `${JSON.stringify(token.value)} at column ${token.column}`; }
  expect(kind, what) {
    const token = this.next();
    if (token.kind !== kind) this.fail(`expected ${what}, found ${this.describe(token)}`);
    return token;
  }
  keyword(word) {
    const token = this.peek();
    return token.kind === "ident" && token.value.toLowerCase() === word;
  }
  end() {
    const token = this.peek();
    if (token.kind !== "end") this.fail(`unexpected ${this.describe(token)}`);
  }
  // source := IDENT 'as' IDENT
  source() {
    const table = this.expect("ident", "a table name");
    if (!this.keyword("as")) this.fail(`expected "as <alias>" after ${table.value}, found ${this.describe(this.peek())}`);
    this.next();
    const alias = this.expect("ident", "an alias");
    this.end();
    return {table: table.value.toUpperCase(), alias: alias.value.toLowerCase()};
  }
  // conjunction := comparison ('and' comparison)*
  conjunction() {
    const list = [this.comparison()];
    while (this.keyword("and")) {
      this.next();
      list.push(this.comparison());
    }
    this.end();
    return list;
  }
  // comparison := operand OP operand
  comparison() {
    const left = this.operand();
    const op = this.next();
    if (op.kind !== "op") this.fail(`expected a comparison operator (${OPERATORS.join(" ")}), found ${this.describe(op)}`);
    const right = this.operand();
    return {left, op: op.value, right};
  }
  // operand := IDENT '.' IDENT | STRING | NUMBER | PARAM
  operand() {
    const token = this.next();
    if (token.kind === "string") return {kind: "literal", quoted: true, value: token.value, text: `'${token.value}'`};
    if (token.kind === "number") return {kind: "literal", quoted: false, value: token.value, text: token.value};
    if (token.kind === "param") return {kind: "param", name: token.value, text: `$${token.value}`};
    if (token.kind === "ident") {
      if (token.value.toLowerCase() === "and") this.fail(`expected an operand, found "and" at column ${token.column}`);
      this.expect("dot", `"." after ${token.value}`);
      const field = this.expect("ident", "a field name");
      return {kind: "field", alias: token.value.toLowerCase(), field: field.value.toLowerCase(),
        text: `${token.value}.${field.value}`};
    }
    this.fail(`expected an operand, found ${this.describe(token)}`);
  }
}

export function parseSource(text, fail) {
  return new Parser(text, fail).source();
}

export function parseConditions(text, fail) {
  return new Parser(text, fail).conjunction();
}

// alert text: plain text with {alias.field} holes
export function parseAlert(text, fail) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    const close = text.indexOf("}", i);
    if (close >= 0 && (open < 0 || close < open)) fail(`"}" without "{" at column ${close + 1}`);
    if (open < 0) { parts.push({kind: "text", value: text.slice(i)}); break; }
    if (open > i) parts.push({kind: "text", value: text.slice(i, open)});
    const end = text.indexOf("}", open);
    if (end < 0) fail(`"{" at column ${open + 1} is not closed`);
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text.slice(open + 1, end));
    if (!m) fail(`a hole is {alias.field}, found {${text.slice(open + 1, end)}} at column ${open + 1}`);
    parts.push({kind: "hole", alias: m[1].toLowerCase(), field: m[2].toLowerCase(), text: text.slice(open, end + 1)});
    i = end + 1;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// the DDIC: tables, fields, their types in DDIC terms

function tableInfo(registry, name, fail) {
  const object = registry.getObject("TABL", name);
  if (!object) fail(`table ${name} is not in the DDIC given`);
  let key;
  try {
    key = DDIC_PROVIDER(registry, name);
  } catch (error) {
    if (error instanceof Refusal) fail(error.message);
    throw error;
  }
  const type = object.parseType(registry);
  const components = type.getComponents?.() ?? [];
  const clientDependent = /<CLIDEP>X</.test(object.getXML() ?? "");
  const client = clientDependent ? components[0]?.name.toLowerCase() : undefined;
  // the data element by name from the field's DD03P row: abaplint's
  // component type does not carry it, and without it an integer or packed
  // field has no resolved width
  const rollnames = new Map((object.getFields() ?? []).filter((f) => f.ROLLNAME && !f.FIELDNAME.startsWith("."))
    .map((f) => [f.FIELDNAME.toLowerCase(), f.ROLLNAME]));
  const fields = new Map();
  for (const component of components) {
    const column = component.name.toLowerCase();
    fields.set(column, {column, literal: DDIC_PROVIDER.literalType(registry, component.type, rollnames.get(column))});
  }
  return {table: name, fields, client, keys: key.keys.map((k) => k.column)};
}

const CHAR_LIKE = new Set(["CHAR", "CLNT", "LANG", "CUKY", "UNIT", "ACCP", "SSTR", "STRG"]);
const INTEGERS = new Set(["INT1", "INT2", "INT4", "INT8"]);
const PACKED = new Set(["DEC", "CURR", "QUAN"]);
export const DATE_TYPE = {built_in: "DATS", length: 8};

const typeText = (type) => `${type.built_in}${type.length === undefined ? "" : ` ${type.length}`}${type.decimals === undefined ? "" : `,${type.decimals}`}`;

// Whether a value (the text written, quotes removed) fits a DDIC type; the
// reason why not, or undefined. These are the rules of the `literal` filter
// (ZCL_OSD_TPL, METHOD literal), checked here so that the error names the
// rule file and line instead of surfacing in the render. `quoted` is the rule
// language's own: a character-like field takes a quoted literal.
// test/dsl-l2.mjs runs boundary values through both and asserts they agree.
const QUOTED_TYPES = new Set(["CHAR", "NUMC", "CLNT", "LANG", "CUKY", "UNIT", "ACCP", "DATS", "TIMS"]);
const INT_RANGE = {INT1: [0n, 255n], INT2: [-32768n, 32767n], INT4: [-2147483648n, 2147483647n],
  INT8: [-9223372036854775808n, 9223372036854775807n]};

export function misfit(value, type, quoted = true) {
  const b = type.built_in;
  const length = type.length ?? 0;
  let literal;
  if (QUOTED_TYPES.has(b)) {
    if (!quoted) return `${typeText(type)} takes a quoted literal, not the number ${value}`;
    if (value.length > length) return `'${value}' is ${value.length} characters, longer than ${typeText(type)}`;
    if (b === "NUMC" && !/^[0-9]+$/.test(value)) return `'${value}' is not digits for NUMC`;
    if (b === "DATS" && !/^[0-9]{8}$/.test(value)) return `'${value}' is not a date (DATS, 8 digits YYYYMMDD)`;
    if (b === "TIMS" && !/^[0-9]{6}$/.test(value)) return `'${value}' is not a time (TIMS, 6 digits HHMMSS)`;
    literal = value.replaceAll("'", "''");
  } else if (b === "STRG" || b === "SSTR") {
    if (b === "SSTR" && type.length !== undefined && value.length > length) return `'${value}' is ${value.length} characters, longer than ${typeText(type)}`;
    literal = value.replaceAll("`", "``");
  } else if (INT_RANGE[b]) {
    if (!/^-?[0-9]+$/.test(value)) return `${value} is not an integer for ${b}`;
    const [low, high] = INT_RANGE[b];
    const n = BigInt(value);
    if (n < low || n > high) return `${value} is out of range for ${b} (${low}..${high})`;
    return undefined;
  } else if (PACKED.has(b)) {
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return `${value} is not a number for ${b}`;
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const integer = whole.replace(/^0+(?=.)/, "") === "0" ? "" : whole.replace(/^0+(?=.)/, "");
    const decimals = type.decimals ?? 0;
    if (fraction.length > decimals || integer.length > length - decimals) {
      return `${value} exceeds the precision of ${b} ${length},${decimals}`;
    }
    literal = value;
  } else if (b === "RAW") {
    if (value.length % 2 !== 0 || value.length / 2 > length || !/^[0-9A-Fa-f]*$/.test(value)) return `'${value}' is not ${typeText(type)} hex`;
    literal = value;
  } else {
    return `${b} is not a type a rule can compare`;
  }
  // one ABAP literal: one source line, at most 255 characters between the quotes
  if (/[\n\r]/.test(value)) return "a literal cannot hold a line break";
  if (literal.length > 255) return `the literal is ${literal.length} characters once quotes are doubled; ABAP allows 255`;
  return undefined;
}

// ---------------------------------------------------------------------------
// parse + check + compile: rule file -> L1 model

const IDENT = /^[a-z][a-z0-9_]*$/;

export function compileRule(file, {ddic = DEFAULT_DDIC, registry} = {}) {
  const text = readFileSync(file, "utf8");
  const where = relative(process.cwd(), file).split(sep).join("/");
  const failAt = (line) => (message) => { throw new RuleError(where, line, message); };
  let doc;
  try {
    doc = yaml.load(text, {schema: yaml.FAILSAFE_SCHEMA, filename: where});
  } catch (error) {
    throw new RuleError(where, (error.mark?.line ?? 0) + 1, error.reason ?? error.message);
  }
  const index = lineIndex(text);
  const line = (path) => lineOf(index, path);
  const need = (value, path, what, kind = "string") => {
    const ok = kind === "list" ? Array.isArray(value) : kind === "map"
      ? value && typeof value === "object" && !Array.isArray(value) : typeof value === "string" && value.trim() !== "";
    if (!ok) failAt(line(path))(`${path} must be ${what}`);
    return value;
  };
  need(doc, "", "a mapping of the rule's keys", "map");
  const known = new Set(["rule", "class", "title", "for", "when", "forbid", "alert", "examples"]);
  for (const key of Object.keys(doc)) if (!known.has(key)) failAt(line(key))(`unknown key ${key}`);

  const name = need(doc.rule, "rule", "the rule's name");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) failAt(line("rule"))(`rule name ${name} must be lower case letters, digits and "-"`);
  const id = `rule/${name}`;
  const className = (doc.class ?? `zcl_l2_${name.replaceAll("-", "_")}`).toLowerCase();
  if (!/^[yz][a-z0-9_]*$/.test(className) || className.length > 30) {
    failAt(line(doc.class === undefined ? "rule" : "class"))(`class ${className} is not a customer class name of at most 30 characters${doc.class === undefined ? "; name one with class:" : ""}`);
  }
  const title = need(doc.title, "title", "a one-line title");

  registry ??= registryFor(ddic, []);
  const tables = new Map();
  const tableOf = (tableName, path) => {
    if (!tables.has(tableName)) tables.set(tableName, tableInfo(registry, tableName, failAt(line(path))));
    return tables.get(tableName);
  };

  // for / forbid.exists: a table with an alias
  const source = (path, extra) => {
    const parsed = parseSource(need(doc[path] ?? extra, path, "<TABLE> as <alias>"), failAt(line(path)));
    if (!IDENT.test(parsed.alias) || parsed.alias.length > 27) failAt(line(path))(`alias ${parsed.alias} is not a short ABAP name`);
    return {...parsed, info: tableOf(parsed.table, path)};
  };
  const outer = source("for");
  need(doc.forbid, "forbid", "a mapping with exists and where", "map");
  for (const key of Object.keys(doc.forbid)) if (!["exists", "where"].includes(key)) failAt(line(`forbid/${key}`))(`unknown key forbid.${key}`);
  const inner = source("forbid/exists", doc.forbid.exists);
  if (inner.alias === outer.alias) failAt(line("forbid/exists"))(`alias ${inner.alias} is already the alias of ${outer.table}`);
  const aliases = new Map([[outer.alias, outer], [inner.alias, inner]]);
  const wa = (alias) => `ls_${alias}`;

  const fieldOf = (operand, scope, fail) => {
    const src = scope.get(operand.alias);
    if (!src) {
      fail(aliases.has(operand.alias) ? `alias ${operand.alias} is not in scope here (in scope: ${[...scope.keys()].join(", ")})`
        : `unknown alias ${operand.alias} (declared: ${[...aliases.keys()].join(", ")})`);
    }
    const field = src.info.fields.get(operand.field);
    if (!field) fail(`${src.table} has no field ${operand.field.toUpperCase()} (${operand.text})`);
    if (field.column === src.info.client) fail(`${operand.text} is the client field; the runtime sets it`);
    if (field.literal.resolved === false) fail(`${operand.text} has no type a rule can compare: ${field.literal.reason}`);
    return {src, field};
  };

  // conditions against the table being selected (`current`); `scope` is
  // every alias the condition may name
  const MIRROR = {"=": "=", "<>": "<>", "<": ">", ">": "<", "<=": ">=", ">=": "<="};
  const conditions = (path, text, current, scope, idBase) => {
    const fail = failAt(line(path));
    return parseConditions(need(text, path, "comparisons joined by and"), fail).map((cmp, i) => {
      let {left, op, right} = cmp;
      const isCurrent = (o) => o.kind === "field" && o.alias === current.alias;
      for (const o of [left, right]) if (o.kind === "field") fieldOf(o, scope, fail);
      for (const o of [left, right]) if (o.kind === "param" && o.name !== "date") fail(`unknown parameter $${o.name} (slice 1 has $date)`);
      if (!isCurrent(left) && isCurrent(right)) {
        [left, right] = [right, left];
        op = MIRROR[op];
      }
      if (!isCurrent(left)) fail(`${cmp.left.text} ${cmp.op} ${cmp.right.text} must name a field of ${current.alias}`);
      if (isCurrent(right)) fail(`${cmp.left.text} ${cmp.op} ${cmp.right.text} compares two fields of ${current.alias}; not in slice 1`);
      const column = fieldOf(left, scope, fail).field;
      const type = column.literal;
      const node = {"@id": `${idBase}/${i + 1}`, rule_line: line(path), column: column.column, op,
        "@type": type, text: `${cmp.left.text} ${cmp.op} ${cmp.right.text}`};
      if (right.kind === "literal") {
        const why = misfit(right.value, type, right.quoted);
        if (why) fail(`${left.text} is ${typeText(type)}; ${why}`);
        return {...node, is_literal: true, value: right.value, "value@type": type};
      }
      if (right.kind === "param") {
        if (type.built_in !== "DATS") fail(`${left.text} is ${typeText(type)}, $date is DATS`);
        return {...node, is_literal: false, ref: "iv_date"};
      }
      const other = fieldOf(right, scope, fail).field.literal;
      if (other.built_in !== type.built_in) fail(`${left.text} is ${typeText(type)}, ${right.text} is ${typeText(other)}`);
      return {...node, is_literal: false, ref: `${wa(right.alias)}-${right.field}`};
    });
  };

  const outerScope = new Map([[outer.alias, outer]]);
  const when = doc.when === undefined ? [] : conditions("when", doc.when, outer, outerScope, `${id}/when`);
  const forbid = conditions("forbid/where", doc.forbid.where, inner, aliases, `${id}/forbid/where`);

  // alert: text and holes
  const alertText = need(doc.alert, "alert", "text with {alias.field} holes");
  const alertFail = failAt(line("alert"));
  let texts = 0, holes = 0;
  const parts = parseAlert(alertText, alertFail).map((part) => {
    if (part.kind === "text") {
      const why = misfit(part.value, {built_in: "STRG"});
      if (why) alertFail(`alert text: ${why}`);
      return {"@id": `${id}/alert/text/${++texts}`, rule_line: line("alert"), is_text: true,
        value: part.value, "value@type": {built_in: "STRG"}};
    }
    const {field} = fieldOf({kind: "field", alias: part.alias, field: part.field, text: part.text}, aliases, alertFail);
    return {"@id": `${id}/alert/hole/${++holes}`, rule_line: line("alert"), is_text: false,
      ref: `${wa(part.alias)}-${field.column}`, "@type": field.literal};
  });
  if (!parts.length) alertFail("alert is empty");

  // examples: rows of the rule's own tables, the date, the alerts expected
  // each table where it enters the rule: `for`, or `forbid.exists`
  const ruleTables = [{...outer.info, rule_line: line("for")},
    ...(inner.table === outer.table ? [] : [{...inner.info, rule_line: line("forbid/exists")}])];
  const testName = (table) => ({itab: `mt_${table.toLowerCase()}`, wa: `ls_${table.toLowerCase()}`});
  const methods = new Set();
  // a rule carries its proof: examples, each saying what it expects
  if (doc.examples === undefined) failAt(line("rule"))("a rule needs examples: none are given");
  if (Array.isArray(doc.examples) && !doc.examples.length) failAt(line("examples"))("a rule needs at least one example");
  const examples = need(doc.examples, "examples", "a list of examples", "list").map((example, e) => {
    const base = `examples/${e}`;
    const fail = failAt(line(base));
    need(example, base, "a mapping with name, date, rows and expect", "map");
    for (const key of Object.keys(example)) if (!["name", "date", "rows", "expect"].includes(key)) failAt(line(`${base}/${key}`))(`unknown key ${key} in an example`);
    const label = need(example.name, `${base}/name`, "the example's name");
    const labelWhy = misfit(label, {built_in: "STRG"});
    if (labelWhy) failAt(line(`${base}/name`))(`example name: ${labelWhy}`);
    const method = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[a-z]/.test(method) || method.length > 30) failAt(line(`${base}/name`))(`example name ${JSON.stringify(label)} gives method ${method}, which is not an ABAP name of at most 30 characters`);
    if (methods.has(method) || ["teardown", "assert_alerts"].includes(method)) failAt(line(`${base}/name`))(`example name ${JSON.stringify(label)} gives method ${method} a second time`);
    methods.add(method);
    const exampleId = `${id}/example/${label}`;
    const date = need(example.date, `${base}/date`, "the check date (YYYYMMDD)");
    const dateWhy = misfit(date, DATE_TYPE);
    if (dateWhy) failAt(line(`${base}/date`))(dateWhy);
    const rows = example.rows === undefined ? {} : need(example.rows, `${base}/rows`, "a mapping of table to rows", "map");
    const exampleTables = Object.keys(rows).map((tableName) => {
      const tpath = `${base}/rows/${tableName}`;
      const info = ruleTables.find((t) => t.table === tableName.toUpperCase());
      if (!info) failAt(line(tpath))(`rows for ${tableName}, which the rule does not read (${ruleTables.map((t) => t.table).join(", ")})`);
      return {"@id": `${exampleId}/table/${info.table.toLowerCase()}`, rule_line: line(tpath), table: info.table.toLowerCase(),
        ...testName(info.table), ...(info.client ? {client: info.client} : {}),
        rows: need(rows[tableName], tpath, "a list of rows", "list").map((row, r) => {
          const rpath = `${tpath}/${r}`;
          const rfail = failAt(line(rpath));
          need(row, rpath, "a mapping of field to value", "map");
          const rowId = `${exampleId}/row/${info.table.toLowerCase()}/${r + 1}`;
          const fields = Object.entries(row).map(([fieldName, value]) => {
            const field = info.fields.get(fieldName.toLowerCase());
            if (!field) rfail(`${info.table} has no field ${fieldName.toUpperCase()}`);
            if (field.column === info.client) rfail(`${fieldName} is the client field; the test sets it`);
            if (field.literal.resolved === false) rfail(`${info.table}-${fieldName.toUpperCase()}: ${field.literal.reason}`);
            if (typeof value !== "string") rfail(`${fieldName} must be a scalar`);
            const why = misfit(value, field.literal);
            if (why) failAt(line(`${rpath}/${fieldName}`))(`${info.table}-${field.column.toUpperCase()} is ${typeText(field.literal)}; ${why}`);
            return {"@id": `${rowId}/field/${field.column}`, rule_line: line(`${rpath}/${fieldName}`), column: field.column,
              value, "value@type": field.literal};
          });
          const missing = info.keys.find((k) => !fields.some((f) => f.column === k));
          if (missing) rfail(`a row of ${info.table} needs its key field ${missing.toUpperCase()}`);
          return {"@id": rowId, rule_line: line(rpath), fields};
        })};
    });
    if (example.expect === undefined) fail(`example ${JSON.stringify(label)} has no expect; write expect: [] when it expects no alert`);
    const expect = need(example.expect, `${base}/expect`, "a list of alert lines", "list");
    return {"@id": exampleId, rule_line: line(base), name: label, method, label, "label@type": {built_in: "STRG"},
      date: {"@id": `${exampleId}/date`, rule_line: line(`${base}/date`), value: date, "value@type": DATE_TYPE,
        call: `${className}=>check`},
      tables: exampleTables,
      expect: expect.map((value, x) => {
        if (typeof value !== "string") failAt(line(`${base}/expect/${x}`))("an expected alert is one line of text");
        const why = misfit(value, {built_in: "STRG"});
        if (why) failAt(line(`${base}/expect/${x}`))(`expected alert: ${why}`);
        return {"@id": `${exampleId}/expect/${x + 1}`, rule_line: line(`${base}/expect/${x}`), value, "value@type": {built_in: "STRG"}};
      })};
  });

  return {
    "@id": id, rule_line: line("rule"), rule: name, title, source: where, class: className,
    for: {"@id": `${id}/for`, rule_line: line("for"), table: outer.table.toLowerCase(), alias: outer.alias,
      itab: `lt_${outer.alias}`, wa: wa(outer.alias)},
    when: {"@id": `${id}/when`, rule_line: line(doc.when === undefined ? "for" : "when"), conditions: when},
    forbid: {"@id": `${id}/forbid`, rule_line: line("forbid"), table: inner.table.toLowerCase(), alias: inner.alias,
      itab: `lt_${inner.alias}`, wa: wa(inner.alias), conditions: forbid},
    alert: {"@id": `${id}/alert`, rule_line: line("alert"), parts},
    tables: ruleTables.map((info) => ({"@id": `${id}/table/${info.table.toLowerCase()}`, rule_line: info.rule_line,
      table: info.table.toLowerCase(), ...testName(info.table)})),
    examples,
  };
}

// ---------------------------------------------------------------------------
// render: model -> ABAP through the two recipes, with the trace

// the nearest node with an @id on a trace path (1-based array indexes)
export function provenance(model, path) {
  let current = model, node = model;
  for (const part of String(path ?? "").split("/").filter(Boolean)) {
    current = Array.isArray(current) ? current[Number(part) - 1] : current?.[part];
    if (current?.["@id"]) node = current;
  }
  return {node: node["@id"], rule_line: node.rule_line};
}

function sidecar(model, template, rendered) {
  return JSON.stringify({
    generator: "dsl-l2", rule: model.source, template,
    model: `sha256:${createHash("sha256").update(JSON.stringify(model)).digest("hex")}`,
    lines: rendered.trace.map((entry) => ({line: entry.line, template_line: entry.template_line, path: entry.path,
      ...provenance(model, entry.path)})),
  }, null, 1) + "\n";
}

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function classXml(model) {
  const description = `L2 rule ${model.rule}`.slice(0, 60);
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><VSEOCLASS><CLSNAME>${model.class.toUpperCase()}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xmlEscape(description)}</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS></asx:values>
 </asx:abap>
</abapGit>
`;
}

// The files of one rule, name -> content, and the profile findings.
export async function renderRule(model) {
  const {renderRecipe} = await import("./dsl-abap.mjs");
  const quiet = console.log;
  let check, test;
  try {
    console.log = (...items) => console.error(...items); // runtime bootstrap diagnostics
    check = await renderRecipe(model, CHECK_TEMPLATE, {profile: "abap"});
    test = await renderRecipe(model, TEST_TEMPLATE, {profile: "abap"});
  } finally {
    console.log = quiet;
  }
  const name = model.class;
  return {
    files: {
      [`${name}.clas.abap`]: check.text,
      [`${name}.clas.testclasses.abap`]: test.text,
      [`${name}.clas.xml`]: classXml(model),
      [`${name}.clas.trace.json`]: sidecar(model, CHECK_TEMPLATE, check),
      [`${name}.clas.testclasses.trace.json`]: sidecar(model, TEST_TEMPLATE, test),
    },
    findings: [...check.findings.map((f) => ({...f, file: `${name}.clas.abap`})),
      ...test.findings.map((f) => ({...f, file: `${name}.clas.testclasses.abap`}))],
  };
}

export async function buildRule(file, out, options = {}) {
  const model = compileRule(file, options);
  const rendered = await renderRule(model);
  mkdirSync(out, {recursive: true});
  for (const [name, content] of Object.entries(rendered.files)) writeFileSync(join(out, name), content);
  return {model, ...rendered};
}

// Regenerate into a scratch folder and compare byte for byte with `out`.
export async function checkRule(file, out, options = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "dsl-l2-"));
  try {
    const {files} = await buildRule(file, scratch, options);
    const drift = [];
    for (const name of Object.keys(files)) {
      let committed;
      try { committed = readFileSync(join(out, name)); } catch { drift.push(`${name}: missing in ${out}`); continue; }
      if (!committed.equals(readFileSync(join(scratch, name)))) drift.push(`${name}: differs from a fresh build`);
    }
    return drift;
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

async function main(args) {
  const [command, file, ...rest] = args;
  const ddic = [];
  let out;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out") out = rest[++i];
    else if (rest[i] === "--ddic") ddic.push(rest[++i]);
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (!["build", "check"].includes(command) || !file || !out) {
    console.error("Usage: node tools/dsl-l2.mjs <build|check> <rule.l2.yaml> --out <dir> [--ddic <folder>]...");
    return 2;
  }
  const options = ddic.length ? {ddic} : {};
  if (command === "check") {
    const drift = await checkRule(file, out, options);
    for (const line of drift) console.error(line);
    console.log(drift.length ? `${file}: ${drift.length} file(s) drifted; rebuild with: node tools/dsl-l2.mjs build ${file} --out ${out}`
      : `${file}: generated files match`);
    return drift.length ? 1 : 0;
  }
  const {files, findings} = await buildRule(file, out, options);
  for (const name of Object.keys(files)) console.log(`wrote ${join(out, name)}`);
  console.log(`abap profile: ${findings.length} finding(s)`);
  for (const f of findings) console.log(`${f.severity} ${f.file}:${f.line} ${f.rule}: ${f.text} (${f.node})`);
  return findings.some((f) => f.severity === "E") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

