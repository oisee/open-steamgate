// Stage 3 of the SQLScript front end: the syntax tree into the IR.
//
// Two jobs, kept apart on purpose (docs/sqlscript-parser-style.md):
//
//   the binder   turns `FROM :lt1` into the plan `lt1` names. An assignment
//                to a table variable is **not an observable barrier** on HANA
//                (docs/sqlscript-hana-observed.md), so a chain of three
//                assignments is one plan with two of them spliced in, not
//                three statements. Where a barrier did materialise the
//                variable, the binder substitutes `ref(handle)` instead.
//   the typer    puts a `type` on every expression, because the lowering
//                chooses the **form** by it -- a division has no correct
//                rendering in any dialect until the result type is known.
//
// The catalogue is an argument, not an import. The typer needs the type of a
// column, which only a dictionary knows, but taking that from the runtime
// would make this stage depend on a running system; a plain
// `{TABLE: {COLUMN: type}}` keeps it a pure function of its inputs and lets a
// test state the schema it is talking about.
//
// What it refuses, it refuses by name. A construct this stage does not
// understand must not come out as something close to the truth: the whole
// point of the IR is that the lowering can trust the node names.

import {T, col, lit, param, bin, call, cast, scan, refTo, filter, project, join, union, order,
  schemaOf} from "../sqlscript-ir.mjs";

export class BindError extends Error {
  constructor(message, node) {
    const where = node?.line === undefined ? "" : `: line ${node.line} col ${node.col}`;
    super(`${message}${where}`);
    this.line = node?.line;
    this.col = node?.col;
  }
}

/** the children of a syntax node, by node name */
const kids = (node, name) => (node.children ?? []).filter((c) => c.node === name);
const kid = (node, name) => kids(node, name)[0];
const words = (node) => (node.children ?? []).filter((c) => c.node === "word").map((w) => String(w.value).toUpperCase());
/** every descendant word, for the keywords a construct is made of */
const hasWord = (node, word) => {
  if (node.node === "word" && String(node.value).toUpperCase() === word) return true;
  return (node.children ?? []).some((c) => hasWord(c, word));
};
/** the first token-ish leaf of a node, which is what a Name or Value is */
const leaf = (node) => {
  if (node.value !== undefined) return node;
  for (const c of node.children ?? []) {
    const found = leaf(c);
    if (found !== undefined) return found;
  }
  return undefined;
};

const nameOf = (node) => String(leaf(node)?.value ?? "").toUpperCase();

/** a literal's ABAP type, from what it is written as */
function literalType(token) {
  if (token.node === "number") {
    return String(token.value).includes(".") ? T.dec(15, 2) : T.int;
  }
  return T.char(String(token.value).length);
}

export function toIr(tree, options = {}) {
  const catalogue = options.catalogue ?? {};
  /** table variables assigned so far: name -> {rel} or {handle} */
  const bound = new Map();
  /** the table a bare column belongs to, while a SELECT is being read */
  let columns = {};

  const typeOfColumn = (name) => columns[name] ?? T.str;

  function expression(node) {
    switch (node.node) {
      case "Expr":
      case "Term": {
        const parts = (node.children ?? []).filter((c) => c.node !== "word");
        const ops = (node.children ?? []).filter((c) => c.node === "word").map((w) => w.value);
        let left = expression(parts[0]);
        for (let i = 1; i < parts.length; i += 1) {
          const op = ops[i - 1] ?? "+";
          const right = expression(parts[i]);
          // the result type of arithmetic is the wider of the two, and a
          // division is decimal because that is what HANA answers -- measured
          // (docs/sqlscript-hana-observed.md), not assumed from SQL folklore
          const type = op === "/" ? T.dec(15, 2)
            : (left.type?.abap === "P" || right.type?.abap === "P" ? T.dec(15, 2) : left.type);
          left = bin(op, left, right, type);
        }
        return left;
      }
      case "Factor":
      case "Value":
      case "SelectItem":
      case "OrderKey":
      case "Predicate": {
        const inner = (node.children ?? []).filter((c) => c.node !== "word");
        if (inner.length === 1) return expression(inner[0]);
        break;
      }
      case "FunctionCall": {
        const fn = String(leaf(node).value).toUpperCase();
        const args = (node.children ?? []).filter((c) => c.node === "Expr").map(expression);
        // CAST is its own node in the IR, because the lowering has to decide
        // per engine whether a failing cast can even raise
        if (fn === "CAST" || fn === "TO_INTEGER") {
          return cast(args[0] ?? lit(null, T.str), fn === "TO_INTEGER" ? T.int : T.str);
        }
        return call(fn, args, T.str);
      }
      case "ColumnRef": {
        const name = nameOf(node);
        return col(name, typeOfColumn(name));
      }
      case "identifier":
      case "quoted": {
        const name = String(node.value).toUpperCase();
        return col(name, typeOfColumn(name));
      }
      case "string":
        return lit(String(node.value), T.char(String(node.value).length));
      case "number":
        return lit(Number(node.value), literalType(node));
      case "host":
        // a host variable is a **bound parameter**, never text: that is the
        // guarantee the native channel exists for
        return param(String(node.value).slice(1).toUpperCase(), T.str);
      case "operator":
        if (node.value === "?") return param("p", T.str);
        break;
      default:
        break;
    }
    const only = (node.children ?? []).filter((c) => c.node !== "word");
    if (only.length === 1) return expression(only[0]);
    throw new BindError(`cannot type ${node.node}`, node);
  }

  function condition(node) {
    const parts = (node.children ?? []).filter((c) => c.node === "Predicate");
    const joiners = (node.children ?? []).filter((c) => c.node === "word")
      .map((w) => String(w.value).toUpperCase()).filter((w) => w === "AND" || w === "OR");
    let left = predicate(parts[0]);
    for (let i = 1; i < parts.length; i += 1) {
      left = bin(joiners[i - 1] ?? "AND", left, predicate(parts[i]), T.bool);
    }
    return left;
  }

  const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

  function predicate(node) {
    const sides = (node.children ?? []).filter((c) => c.node === "Expr");
    // The comparison arrives as a `word`, not as an `operator`: the grammar
    // matches it with str(), which produces a word node whatever the token
    // was. Reading only `operator` children left every comparison defaulting
    // to `=` -- a wrong operator, silently, which is the worst shape a defect
    // in this stage can take. Both are read, and there is a test for `>`.
    const ops = (node.children ?? [])
      .filter((c) => c.node === "operator" || c.node === "word")
      .map((o) => String(o.value))
      .filter((v) => COMPARISONS.has(v));
    if (sides.length === 1) return expression(sides[0]);
    if (ops.length === 0) {
      throw new BindError("a comparison without an operator", node);
    }
    return bin(ops[0], expression(sides[0]), expression(sides[1]), T.bool);
  }

  function source(node) {
    const host = (node.children ?? []).find((c) => c.node === "host");
    if (host !== undefined) {
      const name = String(host.value).slice(1).toUpperCase();
      const known = bound.get(name);
      if (known === undefined) {
        // named, not guessed: a table called like a variable is ordinary, so
        // reading one silently would be plausible and wrong
        throw new BindError(`unknown table variable :${name.toLowerCase()}`, host);
      }
      if (known.handle === undefined) {
        // the ordinary case: an assignment is not an observable barrier on
        // HANA, so the plan goes in where the FROM stands
        return known.rel;
      }
      // a barrier materialised it. `ref` is the one node whose columns cannot
      // be derived from what is under it, because nothing is; the schema has
      // to be carried, and the moment it is known is the moment the barrier
      // was made. refTo() puts it there -- a bare ref is refused by
      // schemaOf, so the right path is also the shorter one (fable-osd).
      return refTo(known.handle, schemaOf(known.rel, catalogue));
    }
    const sub = kid(node, "SetOperation");
    if (sub !== undefined) return relation(sub);
    const temp = (node.children ?? []).find((c) => c.node === "temp");
    if (temp !== undefined) return scan(String(temp.value).toUpperCase());
    const table = nameOf(node);
    columns = catalogue[table] ?? columns;
    return scan(table);
  }

  function select(node) {
    let rel;
    const from = kid(node, "Source");
    if (from !== undefined) rel = source(from);
    for (const j of kids(node, "Join")) {
      const right = source(kid(j, "Source"));
      const on = kid(j, "Condition");
      rel = join(rel, right, on === undefined ? undefined : condition(on),
        hasWord(j, "CROSS") ? "cross" : (hasWord(j, "LEFT") ? "left" : "inner"));
    }
    const where = kid(node, "Condition");
    if (where !== undefined) rel = filter(rel, condition(where));
    const items = kids(node, "SelectItem").map((item) => {
      const star = (item.children ?? []).some((c) => c.node === "operator" && c.value === "*");
      if (star) return {as: "*", expr: {node: "star"}};
      const alias = kids(item, "Name")[0];
      const expr = expression((item.children ?? []).find((c) => c.node !== "word" && c !== alias));
      return {as: alias === undefined ? (expr.name ?? "V") : nameOf(alias), expr};
    });
    rel = project(rel, items);
    const keys = kids(node, "OrderKey");
    if (keys.length > 0) {
      rel = order(rel, keys.map((k) => ({expr: expression(k), dir: hasWord(k, "DESC") ? "desc" : "asc"})));
    }
    return rel;
  }

  function relation(node) {
    const selects = kids(node, "Select");
    if (selects.length === 1) return select(selects[0]);
    const all = hasWord(node, "ALL");
    return union(selects.map(select), all);
  }

  // the body: assignments bind, the last statement is the plan asked for
  const statements = [];
  for (const assignment of kids(tree, "Assignment")) {
    const name = nameOf(kid(assignment, "Name"));
    const rel = relation(kid(assignment, "SetOperation"));
    bound.set(name, {rel});
    statements.push({stmt: "assign", name, rel});
  }
  const last = kids(tree, "SetOperation").pop();
  if (last === undefined) throw new BindError("a body has to end in a statement", tree);
  return {statements, rel: relation(last)};
}
