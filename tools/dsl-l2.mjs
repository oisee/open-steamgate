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
import {INT_RANGE, PACKED, allReferences, canonical, deriveCases, evaluate, kindOf} from "./dsl-l2-eval.mjs";

export {evaluate, stepValue} from "./dsl-l2-eval.mjs";

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
// the words of the condition language; none of them can be an alias
export const KEYWORDS = new Set(["and", "or", "not", "as"]);

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
    } else if (c === "(" || c === ")") {
      i++;
      tokens.push({kind: c === "(" ? "open" : "close", value: c, column: start + 1});
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
  // condition   := disjunction
  // disjunction := conjunction ('or' conjunction)*
  // conjunction := negation ('and' negation)*
  // negation    := 'not' negation | '(' disjunction ')' | comparison
  // A tree: {op: "or" | "and", items}, {op: "not", item}, {op: "cmp", left, op, right, at};
  // an `and` inside an `and` (parentheses) is one `and`, the same for `or`.
  condition() {
    const tree = this.disjunction();
    this.end();
    return tree;
  }
  disjunction() { return this.chain("or", () => this.conjunction()); }
  conjunction() { return this.chain("and", () => this.negation()); }
  chain(word, part) {
    const items = [part()];
    while (this.keyword(word)) {
      this.next();
      items.push(part());
    }
    return items.length === 1 ? items[0] : {op: word, items: items.flatMap((x) => x.op === word ? x.items : [x])};
  }
  negation() {
    if (this.keyword("not")) {
      this.next();
      return {op: "not", item: this.negation()};
    }
    if (this.peek().kind === "open") {
      const open = this.next();
      const tree = this.disjunction();
      if (this.peek().kind !== "close") this.fail(`expected ")" to close the "(" at column ${open.column}, found ${this.describe(this.peek())}`);
      this.next();
      return tree;
    }
    return {op: "cmp", ...this.comparison()};
  }
  // comparison := operand OP operand
  comparison() {
    const at = this.peek().column;
    const left = this.operand();
    const op = this.next();
    if (op.kind !== "op") this.fail(`expected a comparison operator (${OPERATORS.join(" ")}), found ${this.describe(op)}`);
    const right = this.operand();
    return {left, cmp: op.value, right, at};
  }
  // operand := IDENT '.' IDENT | STRING | NUMBER | PARAM
  operand() {
    const token = this.next();
    if (token.kind === "string") return {kind: "literal", quoted: true, value: token.value, text: `'${token.value}'`};
    if (token.kind === "number") return {kind: "literal", quoted: false, value: token.value, text: token.value};
    if (token.kind === "param") return {kind: "param", name: token.value, text: `$${token.value}`};
    if (token.kind === "ident") {
      if (KEYWORDS.has(token.value.toLowerCase())) this.fail(`expected an operand, found "${token.value}" at column ${token.column}`);
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

export function parseCondition(text, fail) {
  return new Parser(text, fail).condition();
}

// The rule line of each column of a condition written over several lines: a
// plain scalar continued on more indented lines, or a block scalar (`|`, `>`).
// `value` is what js-yaml read. When the lines joined the way YAML joins them
// are not that value (quotes, escapes, blank lines, indentation kept by `|`),
// every column takes the key's line.
export function scalarLines(text, keyLine, value) {
  const source = text.split(/\r?\n/);
  const whole = () => keyLine;
  const raw = source[keyLine - 1] ?? "";
  let column = raw.length - raw.trimStart().length;
  let rest = raw.slice(column);
  while (rest === "-" || rest.startsWith("- ")) {
    const after = rest.slice(1);
    column += 1 + after.length - after.trimStart().length;
    rest = after.trimStart();
  }
  const key = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#{[\]}:,][^:#]*?)\s*:(?:\s+|$)/.exec(rest);
  if (!key || typeof value !== "string") return whole;
  const first = rest.slice(key[0].length).replace(/\s+#.*$/, "").trimEnd();
  const block = /^[|>]/.test(first);
  if (!block && (first === "" || /^["']/.test(first))) return whole;
  const segments = block ? [] : [{line: keyLine, text: first}];
  for (let i = keyLine; i < source.length; i++) {
    const text = source[i];
    if (text.trim() === "") break;
    if (text.length - text.trimStart().length <= column || (!block && text.trim().startsWith("#"))) break;
    segments.push({line: i + 1, text: text.trim()});
  }
  const joined = segments.map((s) => s.text).join(first.startsWith("|") ? "\n" : " ");
  if (!segments.length || joined !== value.replace(/\n+$/, "")) return whole;
  const starts = [];
  let offset = 1;
  for (const s of segments) {
    starts.push([offset, s.line]);
    offset += s.text.length + 1;
  }
  return (at) => starts.filter(([o]) => o <= at).at(-1)?.[1] ?? keyLine;
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
    const hole = text.slice(open + 1, end).trim();
    if (hole.toLowerCase() === "count") parts.push({kind: "count", text: text.slice(open, end + 1)});
    else {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(hole);
      if (!m) fail(`a hole is {alias.field} or {count}, found {${text.slice(open + 1, end)}} at column ${open + 1}`);
      parts.push({kind: "hole", alias: m[1].toLowerCase(), field: m[2].toLowerCase(), text: text.slice(open, end + 1)});
    }
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
export const DATE_TYPE = {built_in: "DATS", length: 8};

const typeText = (type) => `${type.built_in}${type.length === undefined ? "" : ` ${type.length}`}${type.decimals === undefined ? "" : `,${type.decimals}`}`;

// Whether a value (the text written, quotes removed) fits a DDIC type; the
// reason why not, or undefined. These are the rules of the `literal` filter
// (ZCL_OSD_TPL, METHOD literal), checked here so that the error names the
// rule file and line instead of surfacing in the render. `quoted` is the rule
// language's own: a character-like field takes a quoted literal.
// test/dsl-l2.mjs runs boundary values through both and asserts they agree.
const QUOTED_TYPES = new Set(["CHAR", "NUMC", "CLNT", "LANG", "CUKY", "UNIT", "ACCP", "DATS", "TIMS"]);

// A text cut into pieces of at most PIECE characters as an ABAP literal
// (backticks doubled), never inside a character: what does not fit one line
// is written as several literals joined by &&, one per line.
export const PIECE = 100;
export function pieces(text) {
  const out = [];
  let current = "", width = 0;
  for (const ch of text) {
    const w = ch === "`" ? 2 : ch.length;
    if (width + w > PIECE && current) {
      out.push(current);
      current = "";
      width = 0;
    }
    current += ch;
    width += w;
  }
  if (current || !out.length) out.push(current);
  return out;
}

// An expected alert line of a test method: one literal when it fits, else
// pieces joined into lv_exp (APPEND takes no expression in 7.02).
function expectNode(nodeId, ruleLine, value) {
  const STRG = {built_in: "STRG"};
  const list = pieces(value);
  return {"@id": nodeId, rule_line: ruleLine, value, "value@type": STRG, single: list.length === 1,
    pieces: list.map((piece, k) => ({"@id": `${nodeId}/piece/${k + 1}`, rule_line: ruleLine, value: piece, "value@type": STRG,
      lead: k === 0 ? "lv_exp = " : "  && ", stop: k === list.length - 1 ? "." : ""}))};
}

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
// conditions as lines of Open SQL

// A condition tree with its comparisons in place of their indexes.
const resolve = (tree, leaves) => tree.op === "cmp" ? {op: "cmp", leaf: leaves[tree.index]}
  : tree.op === "not" ? {op: "not", item: resolve(tree.item, leaves)} : {op: tree.op, items: tree.items.map((x) => resolve(x, leaves))};

// One line per comparison: `conn` (AND / OR) and `opens` ("( ", "NOT ( ")
// before it, `closes` after it; `depth` is how many parentheses enclose the
// connector. A group inside another group, and whatever follows a NOT, is
// parenthesised, so the lines never lean on the precedence of Open SQL (which
// is the rule language's: NOT, then AND, then OR). `exists` is require's
// subquery.
function layout(node, parent, depth) {
  const line = (extra) => ({conn: "", opens: "", closes: "", depth, ...extra});
  if (node.op === "cmp") return [line({leaf: node.leaf})];
  if (node.op === "exists") {
    const {clause} = node;
    const body = layout(resolve(clause.tree, clause.conditions), 0, depth + 2);
    body[0].lead = {indent: 2 + 2 * (depth + 1), word: "WHERE"};
    body.at(-1).closes += " )";
    return [line({text: `NOT EXISTS ( SELECT * FROM ${clause.table} AS ${clause.alias}`, clause}), ...body];
  }
  if (node.op === "not") {
    const inner = layout(node.item, 0, depth + 1);
    inner[0].opens = `NOT ( ${inner[0].opens}`;
    inner.at(-1).closes += " )";
    return inner;
  }
  const paren = parent > 0;
  const d = paren ? depth + 1 : depth;
  const lines = node.items.flatMap((item, i) => {
    const sub = layout(item, 1, d);
    if (i > 0) Object.assign(sub[0], {conn: node.op.toUpperCase(), depth: d});
    return sub;
  });
  if (paren) {
    lines[0].opens = `( ${lines[0].opens}`;
    lines.at(-1).closes += " )";
  }
  return lines;
}

// The lines of a WHERE: `pre` is what comes before the comparison (after
// `base`), `post` the parentheses closed after it. A comparison line is the
// comparison's node, so it traces to its own rule line; a subquery's head is
// its clause's.
function whereLines(tree, base = "") {
  if (!tree) return [];
  return layout(tree, 0, 0).map((l, i) => {
    const pre = i === 0 ? `${base}WHERE ${l.opens}`
      : l.lead ? `${base}${" ".repeat(l.lead.indent)}${l.lead.word} ${l.opens}`
        : `${base}${" ".repeat(2 + 2 * l.depth)}${l.conn.padStart(3)} ${l.opens}`;
    if (l.leaf) return {...l.leaf, pre, post: l.closes, is_cmp: true};
    return {"@id": l.clause["@id"], rule_line: l.clause.exists_line, pre, text: l.text, post: l.closes, is_cmp: false, is_literal: false};
  });
}

// the conjunction of several trees, one `and` however they were written
const conjoin = (trees) => {
  const items = trees.filter(Boolean).flatMap((t) => t.op === "and" ? t.items : [t]);
  return items.length === 0 ? undefined : items.length === 1 ? items[0] : {op: "and", items};
};

// ---------------------------------------------------------------------------
// parse + check + compile: rule file -> L1 model

const IDENT = /^[a-z][a-z0-9_]*$/;
const MAX_CLAUSES = 3;

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
    if (!ok) failAt(line(path))(`${path.replaceAll("/", ".")} must be ${what}`);
    return value;
  };
  need(doc, "", "a mapping of the rule's keys", "map");
  const known = new Set(["rule", "class", "title", "for", "when", "forbid", "require", "limit", "alert", "boundaries", "examples"]);
  for (const key of Object.keys(doc)) if (!known.has(key)) failAt(line(key))(`unknown key ${key}`);

  const name = need(doc.rule, "rule", "the rule's name");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) failAt(line("rule"))(`rule name ${name} must be lower case letters, digits and "-"`);
  const id = `rule/${name}`;
  if (doc.class !== undefined) need(doc.class, "class", "a class name (text)");
  const className = (doc.class ?? `zcl_l2_${name.replaceAll("-", "_")}`).toLowerCase();
  if (!/^[yz][a-z0-9_]*$/.test(className) || className.length > 30) {
    failAt(line(doc.class === undefined ? "rule" : "class"))(`class ${className} is not a customer class name of at most 30 characters${doc.class === undefined ? "; name one with class:" : ""}`);
  }
  const title = need(doc.title, "title", "a one-line title");
  if (/[\r\n]/.test(title)) failAt(line("title"))("title must be one line");

  registry ??= registryFor(ddic, []);
  const tables = new Map();
  const tableOf = (tableName, path) => {
    if (!tables.has(tableName)) tables.set(tableName, tableInfo(registry, tableName, failAt(line(path))));
    return tables.get(tableName);
  };

  // for / exists: a table with an alias
  const source = (path, value) => {
    const parsed = parseSource(need(value, path, "<TABLE> as <alias>"), failAt(line(path)));
    if (!IDENT.test(parsed.alias) || parsed.alias.length > 27) failAt(line(path))(`alias ${parsed.alias} is not a short ABAP name`);
    if (KEYWORDS.has(parsed.alias)) failAt(line(path))(`alias ${parsed.alias} is a word of the condition language`);
    return {...parsed, info: tableOf(parsed.table, path)};
  };
  const outer = source("for", doc.for);
  const wa = (alias) => `ls_${alias}`;

  // forbid: one exists, or all: / any: of two or three; require: one exists
  const present = ["forbid", "require", "limit"].filter((k) => doc[k] !== undefined);
  if (doc.forbid !== undefined && doc.require !== undefined && doc.limit === undefined) {
    failAt(line("require"))("a rule has forbid or require, not both");
  }
  if (present.length === 0) failAt(line("rule"))("a rule needs forbid: (no row may match) or require: (a row must match) or limit: (a count must exceed a threshold)");
  if (present.length !== 1) failAt(line(present[1] ?? "rule"))("a rule needs exactly one of forbid:, require:, or limit:");
  const kind = present[0];
  need(doc[kind], kind, kind === "limit" ? "a mapping with count, where and a threshold" : "a mapping with exists and where", "map");
  let threshold;
  // more_than / at_least count from above (slice 4); fewer_than / exactly
  // need the for rows with no related row at all, counted 0 (slice 5)
  const THRESHOLDS = ["more_than", "at_least", "fewer_than", "exactly"];
  if (kind === "limit") {
    const spec = doc.limit;
    for (const key of Object.keys(spec)) if (!["count", "where", ...THRESHOLDS].includes(key)) failAt(line(`limit/${key}`))(`unknown key limit.${key}`);
    const keys = THRESHOLDS.filter((k) => spec[k] !== undefined);
    if (keys.length !== 1) failAt(line(keys[1] ? `limit/${keys[1]}` : "limit"))("limit needs exactly one of more_than, at_least, fewer_than or exactly");
    const key = keys[0], value = spec[key];
    if (!/^(0|[1-9][0-9]*)$/.test(value ?? "") || BigInt(value ?? -1) > 2147483647n) failAt(line(`limit/${key}`))(`${key} must be a non-negative INT4 integer`);
    if (key === "at_least" && value === "0") failAt(line(`limit/${key}`))("at_least: 0 holds for every for row; it is no rule");
    if (key === "fewer_than" && value === "0") failAt(line(`limit/${key}`))("fewer_than: 0 never holds: a count is never below 0");
    const op = {more_than: ">", at_least: ">=", fewer_than: "<", exactly: "="}[key];
    threshold = {"@id": `${id}/limit/${key}`, rule_line: line(`limit/${key}`), op, value: Number(value), key,
      ...(key === "fewer_than" || key === "exactly" ? {zero: true} : {})};
  }
  const listKey = ["all", "any"].find((k) => doc[kind][k] !== undefined);
  let combine = "one", specs;
  if (listKey) {
    if (kind === "require") failAt(line(`require/${listKey}`))(`require takes one exists and where, not ${listKey}`);
    for (const key of Object.keys(doc.forbid)) if (key !== listKey) failAt(line(`forbid/${key}`))(`forbid.${listKey} stands alone: ${key} belongs inside one of its clauses`);
    const list = need(doc.forbid[listKey], `forbid/${listKey}`, "a list of clauses, each with exists and where", "list");
    if (list.length < 2) failAt(line(`forbid/${listKey}`))(`forbid.${listKey} needs two or three clauses; write one clause as forbid.exists and forbid.where`);
    if (list.length > MAX_CLAUSES) failAt(line(`forbid/${listKey}/${MAX_CLAUSES}`))(`forbid.${listKey} holds at most ${MAX_CLAUSES} clauses`);
    combine = listKey;
    specs = list.map((value, i) => ({path: `forbid/${listKey}/${i}`, id: `${id}/forbid/${listKey}/${i + 1}`, value}));
  } else {
    specs = [{path: kind, id: `${id}/${kind}`, value: doc[kind]}];
  }
  const aliases = new Map([[outer.alias, outer]]);
  const sources = specs.map((spec) => {
    need(spec.value, spec.path, "a mapping with exists and where", "map");
    const allowed = kind === "limit" ? ["count", "where", ...THRESHOLDS] : combine === "any" ? ["exists", "where", "alert"] : ["exists", "where"];
    for (const key of Object.keys(spec.value)) if (!allowed.includes(key)) failAt(line(`${spec.path}/${key}`))(`unknown key ${spec.path.replaceAll("/", ".")}.${key}`);
    const epath = `${spec.path}/${kind === "limit" ? "count" : "exists"}`;
    const inner = source(epath, spec.value[kind === "limit" ? "count" : "exists"]);
    if (aliases.has(inner.alias)) failAt(line(epath))(`alias ${inner.alias} is already the alias of ${aliases.get(inner.alias).table}`);
    if (inner.table === outer.table) failAt(line(epath))(`for and exists are both ${outer.table}; a rule joins different tables`);
    const twin = [...aliases.values()].find((s) => s.table === inner.table);
    // under any each clause is its own query, so two clauses may read one table
    // (each its own alias, its own row in the derived cases); under all the
    // derived cases empty a clause's table to make it unmatched, which would
    // empty the other clause too
    if (twin && (combine !== "any" || twin === outer)) {
      failAt(line(epath))(`${inner.table} is read twice (as ${twin.alias} and ${inner.alias}); ${combine === "all"
        ? "under all each clause reads its own table (its zero case empties that table); any allows a table twice" : "a rule joins different tables"}`);
    }
    aliases.set(inner.alias, inner);
    return {spec, inner};
  });

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

  // one comparison against the table being selected (`current`); `scope` is
  // every alias it may name
  const MIRROR = {"=": "=", "<>": "<>", "<": ">", ">": "<", "<=": ">=", ">=": "<="};
  const comparison = (cmp, current, scope, nodeId, ruleLine) => {
    const fail = failAt(ruleLine);
    let {left, cmp: op, right} = cmp;
    const written = `${cmp.left.text} ${cmp.cmp} ${cmp.right.text}`;
    const isCurrent = (o) => o.kind === "field" && o.alias === current.alias;
    for (const o of [left, right]) if (o.kind === "field") fieldOf(o, scope, fail);
    for (const o of [left, right]) if (o.kind === "param" && o.name !== "date") fail(`unknown parameter $${o.name} (a rule has $date)`);
    if (!isCurrent(left) && isCurrent(right)) {
      [left, right] = [right, left];
      op = MIRROR[op];
    }
    if (!isCurrent(left)) fail(`${written} must name a field of ${current.alias}`);
    if (isCurrent(right)) fail(`${written} compares two fields of ${current.alias}; not in slice 1`);
    const column = fieldOf(left, scope, fail).field;
    const type = column.literal;
    // `lhs` and `sref` are the qualified columns of the one query (alias~column),
    // `ref` the work-area component of the nested reference form; `cmp` is the
    // comparison as data for the interpreter (tools/dsl-l2-eval.mjs)
    const node = {"@id": nodeId, rule_line: ruleLine, column: column.column, op,
      "@type": type, text: written, lhs: `${left.alias}~${column.column}`};
    const cmpBase = {alias: left.alias, column: column.column, op, type};
    if (right.kind === "literal") {
      const why = misfit(right.value, type, right.quoted);
      if (why) fail(`${left.text} is ${typeText(type)}; ${why}`);
      // a NUMC literal is the column's own text ('12' in NUMC 4 is '0012'): a system
      // converts it, the database of this runtime would compare the digits as written
      const value = type.built_in === "NUMC" ? canonical(type, right.value) : right.value;
      return {...node, is_literal: true, value, "value@type": type,
        cmp: {...cmpBase, rhs: {kind: "literal", value}}};
    }
    if (right.kind === "param") {
      if (type.built_in !== "DATS") fail(`${left.text} is ${typeText(type)}, $date is DATS`);
      return {...node, is_literal: false, ref: "iv_date", sref: "iv_date",
        cmp: {...cmpBase, rhs: {kind: "param", name: right.name}}};
    }
    const other = fieldOf(right, scope, fail).field.literal;
    // the query compares the columns on the database, the nested form a host value
    // converted to the column's type: only identical types mean the same thing
    if (other.built_in !== type.built_in || other.length !== type.length || other.decimals !== type.decimals) {
      fail(`${left.text} is ${typeText(type)}, ${right.text} is ${typeText(other)}; a field-to-field comparison needs the same type, length and decimals`);
    }
    return {...node, is_literal: false, ref: `${wa(right.alias)}-${right.field}`, sref: `${right.alias}~${right.field}`,
      cmp: {...cmpBase, rhs: {kind: "field", alias: right.alias, column: right.field, type: other}}};
  };

  // Two comparisons are the same when they are after the mirroring above:
  // the field of the selected table on the left (so `a = b` and `b = a`,
  // `a < b` and `b > a` meet), the other side by its value as the field
  // holds it (CHAR without trailing blanks, 12.5 and 12.50 in a DEC alike).
  const identity = ({cmp}) => {
    const rhs = cmp.rhs;
    const value = rhs.kind === "literal" ? (kindOf(cmp.type) === "char" ? rhs.value.replace(/ +$/, "") : canonical(cmp.type, rhs.value))
      : rhs.kind === "param" ? `$${rhs.name}` : `${rhs.alias}.${rhs.column}`;
    return `${cmp.alias}.${cmp.column} ${cmp.op} ${rhs.kind}:${value}`;
  };
  // A `not` or a group is compared as a unit: its key is built from the keys
  // of what it holds (the items of a group in any order).
  const keyOf = (node, leaves) => node.op === "cmp" ? identity(leaves[node.index])
    : node.op === "not" ? `not(${keyOf(node.item, leaves)})` : `${node.op}(${node.items.map((x) => keyOf(x, leaves)).sort().join(",")})`;
  const textOf = (node, leaves) => node.op === "cmp" ? leaves[node.index].text
    : node.op === "not" ? `not ${node.item.op === "cmp" ? textOf(node.item, leaves) : `(${textOf(node.item, leaves)})`}`
      : node.items.map((x) => x.op === "cmp" || x.op === "not" ? textOf(x, leaves) : `(${textOf(x, leaves)})`).join(` ${node.op} `);
  const firstLeaf = (node) => node.op === "cmp" ? node : firstLeaf(node.op === "not" ? node.item : node.items[0]);
  const refuseDuplicates = (tree, leaves) => {
    if (tree.op === "cmp") return;
    if (tree.op === "not") { refuseDuplicates(tree.item, leaves); return; }
    const seen = new Map();
    for (const item of tree.items) {
      refuseDuplicates(item, leaves);
      const key = keyOf(item, leaves);
      if (seen.has(key)) {
        failAt(leaves[firstLeaf(item).index].rule_line)(`${textOf(item, leaves)} repeats ${textOf(seen.get(key), leaves)} in the same ${tree.op === "and" ? "conjunction" : "disjunction"}`);
      }
      seen.set(key, item);
    }
  };

  // A condition: the tree over the comparisons (by index), and the list of
  // comparisons in the order written; each comparison's rule line is the
  // line it is written on.
  const condition = (path, value, current, scope, idBase) => {
    const keyLine = line(path);
    const written = need(value, path, "a condition: comparisons joined by and, or, not and parentheses");
    const lineAt = scalarLines(text, keyLine, written);
    const parsed = parseCondition(written, failAt(keyLine));
    const conditions = [];
    const build = (node) => {
      if (node.op === "cmp") {
        conditions.push(comparison(node, current, scope, `${idBase}/${conditions.length + 1}`, lineAt(node.at)));
        return {op: "cmp", index: conditions.length - 1};
      }
      if (node.op === "not") return {op: "not", item: build(node.item)};
      return {op: node.op, items: node.items.map(build)};
    };
    const tree = build(parsed);
    refuseDuplicates(tree, conditions);
    return {tree, conditions};
  };

  const outerScope = new Map([[outer.alias, outer]]);
  const when = doc.when === undefined ? {conditions: []} : condition("when", doc.when, outer, outerScope, `${id}/when`);

  // each clause: its where, the equalities at its top that join it to `for`
  // (the ON of the query, the correlation of require's subquery), the rest
  const joinEquality = (c) => c.cmp.rhs.kind === "field" && c.cmp.op === "=";
  const clauses = sources.map(({spec, inner}) => {
    const wpath = `${spec.path}/where`;
    const scope = new Map([[outer.alias, outer], [inner.alias, inner]]);
    const {tree, conditions} = condition(wpath, spec.value.where, inner, scope, `${spec.id}/where`);
    const top = tree.op === "and" ? tree.items : [tree];
    const isOn = (t) => t.op === "cmp" && joinEquality(conditions[t.index]);
    if (!top.some(isOn)) {
      const purpose = kind === "require" ? "the correlation of the subquery" : combine === "all" ? "every clause of all joins the for table in the one query" : "the join condition of the query";
      failAt(line(wpath))(`where needs an equality between a field of ${inner.alias} and a field of ${outer.alias}, joined to the rest by and (${purpose})`);
    }
    return {"@id": spec.id, rule_line: line(spec.path), exists_line: line(`${spec.path}/${kind === "limit" ? "count" : "exists"}`), path: spec.path,
      table: inner.table.toLowerCase(), alias: inner.alias, itab: `lt_${inner.alias}`, wa: wa(inner.alias), loops: kind !== "require",
      slot: sources.slice(0, sources.findIndex((x) => x.spec === spec)).filter((x) => x.inner.table === inner.table).length,
      conditions, tree, on: top.filter(isOn).map((t) => conditions[t.index]), rest: conjoin(top.filter((t) => !isOn(t))),
      info: inner.info, alertSpec: spec.value.alert};
  });

  // alerts: text and holes
  const alertOf = (path, value, scope, idBase, only) => {
    const alertText = need(value, path, "text with {alias.field} holes");
    const alertFail = failAt(line(path));
    let texts = 0, holes = 0;
    const parts = parseAlert(alertText, alertFail).flatMap((part) => {
      if (part.kind === "count") {
        if (kind !== "limit") alertFail("{count} is available only for limit rules");
        return {"@id": `${idBase}/alert/count`, rule_line: line(path), is_text: false, is_count: true, ref: "lv_count_text"};
      }
      if (part.kind === "text") {
        const why = misfit(part.value, {built_in: "STRG"});
        if (why) alertFail(`alert text: ${why}`);
        // a long text is several literals joined by &&, one per line
        return pieces(part.value).map((value) => ({"@id": `${idBase}/alert/text/${++texts}`, rule_line: line(path), is_text: true,
          value, "value@type": {built_in: "STRG"}}));
      }
      if (only && part.alias !== outer.alias && aliases.has(part.alias)) alertFail(`${part.text}: ${only}`);
      const {field} = fieldOf({kind: "field", alias: part.alias, field: part.field, text: part.text}, scope, alertFail);
      return {"@id": `${idBase}/alert/hole/${++holes}`, rule_line: line(path), is_text: false,
        alias: part.alias, column: field.column, ref: `${wa(part.alias)}-${field.column}`, "@type": field.literal};
    });
    if (!parts.length) alertFail("alert is empty");
    return {"@id": `${idBase}/alert`, rule_line: line(path), parts};
  };
  let alert;
  if (combine === "any") {
    const shared = doc.alert === undefined ? undefined : alertOf("alert", doc.alert, aliases, id,
      "a shared alert of any names only fields of the for table; give the clause its own alert:");
    alert = shared;
    for (const clause of clauses) {
      if (clause.alertSpec !== undefined) {
        clause.alert = alertOf(`${clause.path}/alert`, clause.alertSpec, new Map([[outer.alias, outer], [clause.alias, aliases.get(clause.alias)]]), clause["@id"]);
      } else if (shared) {
        clause.alert = shared;
      } else {
        failAt(clause.rule_line)("a clause of any needs its own alert: or the rule a shared alert:");
      }
    }
  } else {
    alert = alertOf("alert", doc.alert, kind === "require" ? outerScope : aliases, id,
      kind === "require" ? `require alerts when no row of the exists table is there, so its alert names only fields of ${outer.alias}`
        : kind === "limit" ? `limit counts rows of the count table, so its alert names only fields of ${outer.alias}` : undefined);
  }

  // The queries of `check`: one for forbid (the clauses joined) and for
  // require (a NOT EXISTS subquery), one per clause for any (7.02 Open SQL
  // has no UNION). The columns the alert and the order need are fields of
  // one result line, `<alias>_<column>`.
  const whenTree = when.tree && resolve(when.tree, when.conditions);
  const groups = combine === "any" ? clauses.map((c) => [c]) : [clauses];
  const queries = groups.map((group, g) => {
    const multi = groups.length > 1;
    const qid = multi ? `${id}/join/${g + 1}` : `${id}/join`;
    const suffix = multi ? String(g + 1) : "";
    const fields = new Map();
    const field = (alias, column, ruleLine) => {
      const key = `${alias}~${column}`;
      if (!fields.has(key)) {
        const fieldName = `${alias}_${column}`;
        if (fieldName.length > 30) failAt(ruleLine)(`${fieldName} is longer than 30 characters as a field of the joined result; shorten the alias`);
        fields.set(key, {"@id": `${qid}/field/${fields.size + 1}`, rule_line: ruleLine, name: fieldName, source: key,
          table: aliases.get(alias).table.toLowerCase(), column});
      }
      return fields.get(key).name;
    };
    const keysOf = (alias, info, ruleLine) => info.keys.filter((k) => k !== info.client).map((k) => {
      field(alias, k, ruleLine);
      return {source: `${alias}~${k}`, rule_line: ruleLine};
    });
    const order = [...keysOf(outer.alias, outer.info, line("for")),
      ...(["require", "limit"].includes(kind) ? [] : group.flatMap((c) => keysOf(c.alias, c.info, c.exists_line)))]
      .map((entry, n) => ({"@id": `${qid}/order/${n + 1}`, ...entry}));
    const qwa = `ls_join${suffix}`;
    const parts = (combine === "any" ? group[0].alert : alert).parts.map((part) => part.is_text || part.is_count ? {...part, ...(part.is_count ? {jref: "lv_count_text"} : {})}
      : {...part, jref: `${kind === "limit" ? (threshold.zero ? "ls_for" : "ls_prev") : qwa}-${field(part.alias, part.column, part.rule_line)}`});
    const condition = conjoin([whenTree, ...(kind === "require" ? [{op: "exists", clause: group[0]}]
      : group.map((c) => c.rest && resolve(c.rest, c.conditions)))]);
    const group_keys = order.map((o) => ({...o, name: `${outer.alias}_${o.source.split("~")[1]}`}));
    // Slice 5, fewer_than / exactly: a for row with no counted row counts 0,
    // and the INNER JOIN does not return it. Two queries: the for rows that
    // meet `when`, and the joined rows counted per for key (READ, then MODIFY
    // or INSERT: this runtime's COLLECT does not sum, ANORMALIES
    // collect-does-not-sum); the for rows are read in key order and a key
    // the counts lack counts 0. One
    // query with a LEFT OUTER JOIN would need the rest of `where` in its ON,
    // which ABAP 7.02 refuses (docs/dsl-l2.md, "Slice 5").
    const zero = kind === "limit" && threshold.zero ? {"@id": `${qid}/zero`, rule_line: threshold.rule_line,
      op: threshold.op, value: threshold.value,
      keys: group_keys.map((k) => ({"@id": k["@id"], rule_line: k.rule_line, name: k.name,
        table: outer.table.toLowerCase(), column: k.source.split("~")[1]})),
      key_list: group_keys.map((k) => k.name).join(" "),
      read_key: group_keys.map((k) => `${k.name} = ls_for-${k.name}`).join(" "),
      join_key: group_keys.map((k) => `${k.name} = ${qwa}-${k.name}`).join(" "),
      // the read of the for rows traces to the for line, its WHERE to `when`
      for_query: {"@id": `${qid}/for`, rule_line: line("for"),
        from: {"@id": `${id}/for`, rule_line: line("for"), table: outer.table.toLowerCase(), alias: outer.alias},
        where: whereLines(whenTree)}} : undefined;
    return {"@id": qid, rule_line: line(kind), type: `ty_join${suffix}`, itab: `lt_join${suffix}`, wa: qwa,
      fields: [...fields.values()],
      ...(zero ? {zero, join_fields: [...fields.values()].filter((f) => group_keys.some((k) => k.source === f.source))} : {}),
      from: {"@id": `${id}/for`, rule_line: line("for"), table: outer.table.toLowerCase(), alias: outer.alias},
      joins: kind === "require" ? [] : group.map((c) => ({"@id": kind === "limit" ? `${c["@id"]}/count` : c["@id"],
        rule_line: kind === "limit" ? c.exists_line : c.rule_line, table: c.table, alias: c.alias, on: c.on})),
      where: whereLines(condition), order, alert_parts: parts,
      ...(kind === "limit" && !zero ? {limit: threshold, group_keys,
        key_change: group_keys.map((k) => `${qwa}-${k.name} <> ls_prev-${k.name}`).join(" OR ")} : {})};
  });
  const comment = kind === "limit" && threshold.zero ? "two queries: the for rows, and the join rows counted per for key (a key not counted counts 0)"
    : kind === "limit" ? "one query: join rows counted per for key in the loop (HAVING probe fails here)"
    : kind === "require" ? "one query: the rows of the first with no match in a subquery, never a SELECT per row"
    : combine === "any" ? "one query per clause: its table joined to the first, never a SELECT per row of the first"
      : "one query: the tables joined, never a SELECT per row of the first";

  // The reference: the rule as a person would write it, a SELECT on each
  // exists table for every row of the one before (require: none found).
  // One pass for forbid and require; one per clause for any, clause by clause,
  // the order the queries answer in.
  const forNode = {"@id": `${id}/for`, rule_line: line("for"), table: outer.table.toLowerCase(), alias: outer.alias,
    itab: `lt_${outer.alias}`, wa: wa(outer.alias)};
  const level = (node, tree, leaves, indent, isLoop) => ({"@id": node["@id"], rule_line: node.rule_line, indent,
    table: node.table, itab: node.itab, wa: node.wa, is_loop: isLoop,
    where: whereLines(tree && resolve(tree, leaves), `${indent}  `)});
  const pass = (group, parts) => {
    const levels = [level(forNode, when.tree, when.conditions, "    ", true),
      ...group.map((c, k) => level(c, c.tree, c.conditions, " ".repeat(6 + 2 * k), kind !== "require"))];
    const indent = " ".repeat(4 + 2 * levels.length);
    return {"@id": group[0]["@id"], rule_line: group[0].rule_line, indent, levels,
      alert_parts: parts.map((part, k) => ({...part, lead: `${indent}${k === 0 ? "lv_alert = " : "  && "}`, stop: k === parts.length - 1 ? "." : ""})),
      closes: [...levels].reverse().map((l) => ({"@id": l["@id"], rule_line: l.rule_line, indent: l.indent, word: l.is_loop ? "ENDLOOP." : "ENDIF."}))};
  };
  const reference = combine === "any" ? clauses.map((c) => pass([c], c.alert.parts)) : kind === "limit" ? [] : [pass(clauses, alert.parts)];
  const limit_reference = kind === "limit" ? {
    "@id": `${id}/limit/reference`, rule_line: line("limit"), threshold,
    outer: level(forNode, when.tree, when.conditions, "    ", true),
    inner: level({...clauses[0], "@id": `${clauses[0]["@id"]}/count`, rule_line: clauses[0].exists_line},
      clauses[0].tree, clauses[0].conditions, "      ", false),
    alert_parts: alert.parts.map((part, k, parts) => ({...part, lead: `        ${k === 0 ? "lv_alert = " : "  && "}`, stop: k === parts.length - 1 ? "." : ""})),
  } : undefined;

  // examples: rows of the rule's own tables, the date, the alerts expected
  // each table where it enters the rule: `for`, or its clause's `exists`
  const ruleTables = [{...outer.info, rule_line: line("for")}, ...clauses.filter((c) => c.slot === 0).map((c) => ({...c.info, rule_line: c.exists_line}))];
  const testName = (table) => ({itab: `mt_${table.toLowerCase()}`, wa: `ls_${table.toLowerCase()}`});
  const methods = new Set(["check_reference"]);
  // a rule carries its proof: examples, each saying what it expects
  if (doc.examples === undefined) failAt(line("rule"))("a rule needs examples: none are given");
  if (Array.isArray(doc.examples) && !doc.examples.length) failAt(line("examples"))("a rule needs at least one example");
  const raw = []; // the rows and date of each example as the interpreter reads them
  const examples = need(doc.examples, "examples", "a list of examples", "list").map((example, e) => {
    const base = `examples/${e}`;
    const fail = failAt(line(base));
    need(example, base, "a mapping with name, date, rows and expect", "map");
    for (const key of Object.keys(example)) if (!["name", "date", "rows", "expect"].includes(key)) failAt(line(`${base}/${key}`))(`unknown key ${key} in an example`);
    const label = need(example.name, `${base}/name`, "the example's name");
    const labelWhy = misfit(label, {built_in: "STRG"});
    if (labelWhy) failAt(line(`${base}/name`))(`example name: ${labelWhy}`);
    const refWhy = misfit(`${label} (check against check_reference)`, {built_in: "STRG"});
    if (refWhy) failAt(line(`${base}/name`))(`example name with the comparison message: ${refWhy}`);
    const method = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!/^[a-z]/.test(method) || method.length > 30) failAt(line(`${base}/name`))(`example name ${JSON.stringify(label)} gives method ${method}, which is not an ABAP name of at most 30 characters`);
    if (methods.has(method) || ["teardown", "assert_alerts", "assert_same_as_reference"].includes(method)) failAt(line(`${base}/name`))(`example name ${JSON.stringify(label)} gives method ${method} a second time`);
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
    raw.push(Object.fromEntries(Object.entries(rows).map(([t, list]) => [t.toLowerCase(),
      list.map((row) => Object.fromEntries(Object.entries(row).map(([f, v]) => [f.toLowerCase(), v])))])));
    return {"@id": exampleId, rule_line: line(base), name: label, method, label, "label@type": {built_in: "STRG"},
      ref_label: `${label} (check against check_reference)`, "ref_label@type": {built_in: "STRG"},
      date: {"@id": `${exampleId}/date`, rule_line: line(`${base}/date`), value: date, "value@type": DATE_TYPE,
        call: `${className}=>check`},
      tables: exampleTables,
      expect: expect.map((value, x) => {
        if (typeof value !== "string") failAt(line(`${base}/expect/${x}`))("an expected alert is one line of text");
        const why = pieces(value).map((piece) => misfit(piece, {built_in: "STRG"})).find(Boolean);
        if (why) failAt(line(`${base}/expect/${x}`))(`expected alert: ${why}`);
        return expectNode(`${exampleId}/expect/${x + 1}`, line(`${base}/expect/${x}`), value);
      })};
  });
  for (const example of examples) example.long_expect = example.expect.some((x) => !x.single);

  const ddicOf = (info) => ({client: info.client, keys: info.keys.filter((k) => k !== info.client),
    fields: Object.fromEntries([...info.fields].map(([column, f]) => [column, f.literal]))});
  const model = {
    "@id": id, rule_line: line("rule"), rule: name, title, source: where, class: className, kind, combine, comment,
    for: forNode,
    when: {"@id": `${id}/when`, rule_line: line(doc.when === undefined ? "for" : "when"), conditions: when.conditions,
      ...(when.tree ? {tree: when.tree} : {})},
    clauses: clauses.map(({info, alertSpec, rest, ...clause}) => clause),
    ...(alert ? {alert} : {}),
    queries,
    reference, ...(limit_reference ? {limit_reference, threshold} : {}),
    tables: ruleTables.map((info) => ({"@id": `${id}/table/${info.table.toLowerCase()}`, rule_line: info.rule_line,
      table: info.table.toLowerCase(), ...testName(info.table)})),
    ddic: Object.fromEntries(ruleTables.map((info) => [info.table.toLowerCase(), ddicOf(info)])),
    examples,
    cases: [],
  };

  // the hand-written examples against the interpreter: a wrong `expect` is
  // found here, with its line, before any ABAP runs
  examples.forEach((example, e) => {
    const got = evaluate(model, raw[e], {date: example.date.value});
    const want = example.expect.map((x) => x.value);
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...want].sort())) {
      failAt(line(`examples/${e}/expect`))(`example ${JSON.stringify(example.name)} expects ${JSON.stringify(want)} but the rule gives ${JSON.stringify(got)}`);
    }
  });

  // boundaries: derived cases, their expected alerts from the interpreter
  if (doc.boundaries !== undefined) {
    const selected = selection(doc.boundaries, model, failAt, line);
    const first = examples[0];
    const derived = deriveCases(model, selected, {date: first.date.value, example: raw[0], reserved: methods});
    model.skipped = derived.skipped;
    model.cases = derived.cases.map((c) => caseNode(model, c));
  }
  return model;
}

// `boundaries:` is `auto` or a list of condition references
function selection(value, model, failAt, line) {
  const all = allReferences(model);
  if (value === "auto") return all;
  if (!Array.isArray(value)) failAt(line("boundaries"))("boundaries is auto or a list of conditions such as when/1 or forbid/where/2");
  return value.map((entry, i) => {
    if (typeof entry !== "string" || !all.includes(entry)) {
      failAt(line(`boundaries/${i}`))(`boundaries names ${JSON.stringify(entry)}, which is not a condition of the rule (${all.join(", ")})`);
    }
    return entry;
  });
}

// A derived case as an L1 node of the same shape as an example, every node
// tracing to the rule line of the condition it tests.
function caseNode(model, c) {
  const id = `${model["@id"]}/case/${c.method}`;
  const ruleLine = c.line;
  const STRG = {built_in: "STRG"};
  const literal = (nodeId, value, type) => ({"@id": nodeId, rule_line: ruleLine, value, "value@type": type});
  const tables = model.tables.map((t) => {
    const list = c.rows[t.table] ?? [];
    if (!list.length) return undefined;
    const {client, fields} = model.ddic[t.table];
    return {"@id": `${id}/table/${t.table}`, rule_line: ruleLine, table: t.table, itab: t.itab, wa: t.wa,
      ...(client ? {client} : {}),
      rows: list.map((row, r) => {
        const rowId = `${id}/row/${t.table}/${r + 1}`;
        return {"@id": rowId, rule_line: ruleLine,
          fields: Object.entries(fields).filter(([column]) => column !== client).map(([column, type]) => {
            const value = row[column];
            const why = misfit(value, type);
            if (why) throw new Error(`internal: derived value ${JSON.stringify(value)} for ${t.table}-${column}: ${why}`);
            return {...literal(`${rowId}/field/${column}`, value, type), column};
          })};
      })};
  }).filter(Boolean);
  const expect = c.expect.map((value, x) => expectNode(`${id}/expect/${x + 1}`, ruleLine, value));
  const label = c.label;
  const refWhy = misfit(`${label} (check against check_reference)`, STRG);
  if (refWhy) throw new Error(`derived case ${c.method}: ${refWhy}`);
  return {"@id": id, rule_line: ruleLine, name: label, method: c.method, label, "label@type": STRG,
    ref_label: `${label} (check against check_reference)`, "ref_label@type": STRG,
    derived: {condition: c.condition, kind: c.kind, structural: c.structural},
    date: {...literal(`${id}/date`, c.date, DATE_TYPE), call: `${model.class}=>check`},
    tables,
    expect, long_expect: expect.some((x) => !x.single)};
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
export async function renderRule(compiled) {
  // the test class runs the hand-written examples and then the derived cases
  // through one template; the list is made here, so the trace and the model
  // hash are those of what was rendered
  const model = {...compiled, tests: [...compiled.examples, ...compiled.cases]};
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
  // what the abap profile refuses (a line over 255 characters, for one) is
  // refused here, at the rule line of the node the line traces to, before
  // any file is written: a rule the compiler accepts never renders it
  const nodeLine = (nodeId) => {
    let found;
    const walk = (x) => {
      if (found || !x || typeof x !== "object") return;
      if (x["@id"] === nodeId && x.rule_line) { found = x.rule_line; return; }
      for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v);
    };
    walk(model);
    return found ?? model.rule_line;
  };
  for (const [kind, result] of [["clas.abap", check], ["clas.testclasses.abap", test]]) {
    const error = result.findings.find((f) => f.severity === "E");
    if (error) throw new RuleError(model.source, nodeLine(error.node), `the generated ${model.class}.${kind} line ${error.line}: ${error.text} (${error.rule}, ${error.node})`);
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

// What a reviewer reads: each derived case, its rows, and the alerts the
// interpreter expects of it.
export function describeCases(model) {
  const out = [`${model.source}: ${model.examples.length} example(s), ${model.cases.length} derived case(s)`];
  for (const c of model.cases) {
    out.push("", `${c.method}  [${c.derived.condition}, rule line ${c.rule_line}]  ${c.label}`, `  date ${c.date.value}`);
    for (const t of c.tables) {
      for (const r of t.rows) out.push(`  ${t.table}: ${r.fields.map((f) => `${f.column}=${JSON.stringify(f.value)}`).join(" ")}`);
    }
    for (const table of new Set(model.clauses.map((clause) => clause.table))) if (!c.tables.some((t) => t.table === table)) out.push(`  ${table}: (no rows)`);
    out.push(c.expect.length ? `  expect: ${c.expect.map((e) => JSON.stringify(e.value)).join("\n          ")}` : "  expect: no alert");
  }
  for (const k of model.skipped ?? []) out.push("", `skipped ${k.condition}: ${k.reason}`);
  return out.join("\n");
}

// Warns exactly when a derived case was skipped for the 64-row cap, naming
// the cases (a threshold of 32 loses the two-group case, 64 a boundary).
export function capWarning(model, file = model.source) {
  const capped = (model.skipped ?? []).filter((item) => item.cap);
  if (model.kind !== "limit" || !capped.length) return undefined;
  const names = capped.map((item) => `${item.condition} (${item.case})`).join(", ");
  return `${file}:${model.threshold.rule_line}: warning: the 64-row cap skips derived cases: ${names}; examples must cover them`;
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
  if (!["build", "check", "cases"].includes(command) || !file || (!out && command !== "cases")) {
    console.error("Usage: node tools/dsl-l2.mjs <build|check> <rule.l2.yaml> --out <dir> [--ddic <folder>]...\n       node tools/dsl-l2.mjs cases <rule.l2.yaml> [--ddic <folder>]...");
    return 2;
  }
  const options = ddic.length ? {ddic} : {};
  const warnCap = (model) => { const warning = capWarning(model, file); if (warning) console.warn(warning); };
  if (command === "cases") {
    console.log(describeCases(compileRule(file, options)));
    return 0;
  }
  if (command === "check") {
    warnCap(compileRule(file, options));
    const drift = await checkRule(file, out, options);
    for (const line of drift) console.error(line);
    console.log(drift.length ? `${file}: ${drift.length} file(s) drifted; rebuild with: node tools/dsl-l2.mjs build ${file} --out ${out}`
      : `${file}: generated files match`);
    return drift.length ? 1 : 0;
  }
  const {model, files, findings} = await buildRule(file, out, options);
  warnCap(model);
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
