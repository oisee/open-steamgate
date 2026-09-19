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

import {T, col, lit, param, bin, call, cast, not, like, inList, caseWhen,
  subquery, scan, refTo, filter, project, join, union, order, limit, schemaOf} from "../sqlscript-ir.mjs";

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
  // The method signature, which is where fifteen refusals turned out to come
  // from (docs/sqlscript-corpus.md). An AMDP procedure answers through its
  // OUT table parameter -- it assigns and never selects at the end -- and
  // its IN table parameters are unassigned in the body because they arrive
  // from the caller. Without the signature both look like defects in the
  // body, and neither is.
  const signature = options.signature ?? {parameters: []};
  const tableParams = (signature.parameters ?? []).filter((p) => /^(tt_|.*_tab$|.*TABLE.*)/i.test(String(p.abapType ?? ""))
    || /^(it|et|ct)_/i.test(String(p.name ?? "")));
  const outParam = tableParams.find((p) => p.direction === "OUT" || p.direction === "RETURNING");
  /** table variables assigned so far: name -> {rel} or {handle} */
  const bound = new Map();
  /** the table a bare column belongs to, while a SELECT is being read */
  let columns = {};

  const typeOfColumn = (name) => columns[name] ?? T.str;

  function expression(node) {
    if (node === undefined) {
      // a named refusal rather than a crash: an internal `undefined` reaching
      // here means the tree had a shape this stage did not expect, and
      // "cannot read properties of undefined" tells a reader nothing
      throw new BindError("an expression this stage does not recognise");
    }
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
      case "Cast": {
        const inner = (node.children ?? []).filter((c) => c.node === "Expr");
        const named = (node.children ?? []).find((c) => c.node === "TypeName");
        return cast(expression(inner[0]), typeFromName(named));
      }
      case "Case": {
        // The parser keeps the two CASE forms apart; the IR has one, the
        // searched form, because one shape downstream is one shape to lower.
        // The simple form is rewritten here: `CASE x WHEN v` becomes
        // `WHEN x = v`, which is what it means.
        const parts = (node.children ?? []).filter((c) => c.node !== "word");
        const words = (node.children ?? []).filter((c) => c.node === "word")
          .map((w) => String(w.value).toUpperCase());
        // **Which form this is, read from the ordered children and not from
        // the word list.** The word list was the first attempt and it is
        // wrong in a way that always answers "searched": the subject of a
        // simple CASE is an expression, so it is not a word, so `words[1]`
        // is "WHEN" in both forms. Every `CASE x WHEN v` in the corpus then
        // went down the searched path and came out as "a comparison without
        // an operator" -- ten bodies, and the message pointed at the
        // predicate rather than at the CASE that built it.
        const ordered = node.children ?? [];
        const afterCase = ordered[ordered.findIndex((c) => c.node === "word"
          && String(c.value).toUpperCase() === "CASE") + 1];
        const searched = afterCase === undefined || afterCase.node === "word";
        const subject = searched ? undefined : expression(parts[0]);
        const rest = searched ? parts : parts.slice(1);
        // WHEN/THEN come in pairs; an odd tail is the ELSE
        const hasElse = words.includes("ELSE");
        const pairs = hasElse ? rest.slice(0, -1) : rest;
        const otherwise = hasElse ? expression(rest[rest.length - 1]) : undefined;
        const whens = [];
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const left = subject === undefined ? condition(pairs[i]) : bin("=", subject, expression(pairs[i]), T.bool);
          whens.push({when: left, then: expression(pairs[i + 1])});
        }
        if (whens.length === 0) throw new BindError("a CASE with no WHEN", node);
        return caseWhen(whens, otherwise, whens[0].then.type);
      }
      case "FunctionCall": {
        const fn = String(leaf(node).value).toUpperCase();
        const args = (node.children ?? []).filter((c) => c.node === "Expr").map(expression);
        // CAST is its own node in the IR, because the lowering has to decide
        // per engine whether a failing cast can even raise
        // **`MAP(x, a, b, c, d, …, default)` is a CASE and nothing else.**
        // Measured on HANA: a hit answers its value, a miss answers the
        // default, **no default answers NULL**, and `MAP(NULL, …)` answers
        // the default -- which is exactly what `CASE WHEN x = a …` does,
        // because `NULL = a` is NULL and NULL is not true. So it is rewritten
        // here rather than rendered per dialect: one shape downstream, and
        // no engine needs a function it does not have.
        if (fn === "MAP") {
          if (args.length < 3) throw new BindError("MAP needs a value and at least one pair", node);
          const whens = [];
          let i = 1;
          for (; i + 1 < args.length; i += 2) {
            whens.push({when: bin("=", args[0], args[i], T.bool), then: args[i + 1]});
          }
          // an odd argument left over is the default; none means NULL
          const otherwise = i < args.length ? args[i] : undefined;
          return caseWhen(whens, otherwise, whens[0].then.type);
        }
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

  /** the type a `CAST(x AS <here>)` names, as the IR spells types */
  function typeFromName(node) {
    if (node === undefined) throw new BindError("a CAST without a type");
    const words = (node.children ?? []);
    const name = String(words.find((c) => c.node === "identifier" || c.node === "quoted")?.value ?? "").toUpperCase();
    const sizes = words.filter((c) => c.node === "number").map((c) => Number(c.value));
    if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT)$/.test(name)) return T.int;
    if (/^(N?VARCHAR|N?CHAR|ALPHANUM|SHORTTEXT)$/.test(name)) {
      if (sizes[0] === undefined) throw new BindError(`CAST to ${name} without a length`, node);
      return T.char(sizes[0]);
    }
    if (/^(DECIMAL|DEC|SMALLDECIMAL)$/.test(name)) return T.dec(sizes[0] ?? 15, sizes[1] ?? 2);
    // `"$ABAP.type( ... )"` and the rest: named, not guessed. A cast whose
    // target we cannot name is exactly the node the three engines disagree
    // on, so inventing one here would be the worst possible place to guess.
    throw new BindError(`CAST to ${name || "an unnamed type"} has no measured rendering`, node);
  }

  /** One side of an AND/OR. The brackets are a `ConditionTerm` and the thing
   *  inside them is a whole Condition again, so this recurses rather than
   *  looking for Predicate children -- which is what it used to do, and what
   *  made every parenthesised WHERE stop lowering the moment the grammar
   *  learned to read one. */
  function conditionTerm(node) {
    if (node.node === "Condition") return condition(node);
    if (node.node === "ConditionTerm") {
      const inner = (node.children ?? []).filter((c) => c.node !== "word");
      if (inner.length !== 1) throw new BindError("a bracketed condition this stage does not recognise", node);
      return conditionTerm(inner[0]);
    }
    return predicate(node);
  }

  function condition(node) {
    if (node === undefined) throw new BindError("a condition was expected here and the tree has none");
    // Read in order, because NOT binds to the term that FOLLOWS it and a
    // filtered list of children loses which one that was.
    let left;
    let joiner = "AND";
    let negate = false;
    for (const child of node.children ?? []) {
      if (child.node === "word") {
        const word = String(child.value).toUpperCase();
        if (word === "AND" || word === "OR") joiner = word;
        else if (word === "NOT") negate = true;
        continue;
      }
      let next = conditionTerm(child);
      if (negate) {
        next = not(next);
        negate = false;
      }
      left = left === undefined ? next : bin(joiner, left, next, T.bool);
    }
    if (left === undefined) throw new BindError("a condition with nothing in it", node);
    return left;
  }

  const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

  function predicate(node) {
    if (node === undefined) throw new BindError("a predicate was expected here and the tree has none");
    const words = (node.children ?? []).filter((c) => c.node === "word")
      .map((w) => String(w.value).toUpperCase());
    const negated = words.includes("NOT");
    const inner = kid(node, "SetOperation");
    if (inner !== undefined) {
      // A subquery is a relation standing where an expression is expected.
      // It gets its own node rather than a hole in the wall between the two
      // halves of the IR: everything that walks relations reaches inside it
      // by walking `rel`, and nothing learns a second shape.
      const rel = relation(inner);
      if (words.includes("EXISTS")) return subquery("exists", rel, undefined, negated);
      const left = kid(node, "Expr");
      if (left === undefined) throw new BindError("a subquery compared against nothing", node);
      if (words.includes("IN")) return subquery("in", rel, expression(left), negated);
      const op = (node.children ?? []).filter((c) => c.node === "operator" || c.node === "word")
        .map((o) => String(o.value)).find((v) => COMPARISONS.has(v));
      if (op === undefined) throw new BindError("a subquery compared without an operator", node);
      return bin(op, expression(left), subquery("scalar", rel, undefined), T.bool);
    }
    const sides = (node.children ?? []).filter((c) => c.node === "Expr");
    if (words.includes("LIKE")) {
      const escape = words.includes("ESCAPE") ? expression(sides[2]) : undefined;
      return like(expression(sides[0]), expression(sides[1]), escape, negated);
    }
    if (words.includes("IN")) {
      return inList(expression(sides[0]), sides.slice(1).map(expression), negated);
    }
    if (words.includes("BETWEEN")) {
      // two comparisons, which is what it means and what all three engines do
      const value = expression(sides[0]);
      const both = bin("AND",
        bin(">=", value, expression(sides[1]), T.bool),
        bin("<=", value, expression(sides[2]), T.bool), T.bool);
      return negated ? not(both) : both;
    }
    if (words.includes("IS") && words.includes("NULL")) {
      const test = {node: "isnull", expr: expression(sides[0]), type: T.bool};
      return negated ? not(test) : test;
    }
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
    if (node === undefined) throw new BindError("a FROM source was expected here and the tree has none");
    const host = (node.children ?? []).find((c) => c.node === "host");
    if (host !== undefined) {
      const name = String(host.value).slice(1).toUpperCase();
      const known = bound.get(name);
      if (known === undefined && tableParams.some((p) => String(p.name).toUpperCase() === name)) {
        // an IN table parameter: a relation the caller supplies. It is
        // scanned by its own name, which is what the bridge binds it to.
        return scan(name);
      }
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

  /** Hints, which are a request to one engine rather than part of the meaning.
   *
   *  Two of them are not: `INLINE` and `NO_INLINE` change what is observable,
   *  measured on HANA, so they are kept as a fact about the node and the
   *  lowering expresses the barrier structurally instead of emitting the
   *  text. The rest are plan-only and are dropped -- but only by name, from
   *  this list. A hint nobody has looked at is refused, because silently
   *  dropping an unknown one is exactly how a hint that mattered would
   *  disappear. */
  const PLAN_ONLY_HINTS = new Set([
    "NO_USE_HEX_PLAN", "USE_HEX_PLAN", "NO_USE_OLAP_PLAN", "USE_OLAP_PLAN",
    "IGNORE_PLAN_CACHE", "NO_CS_JOIN", "OPTIMIZE_METAMODEL", "ROUTE_TO",
  ]);

  function hintsOf(node) {
    const hint = kid(node, "Hint");
    if (hint === undefined) return undefined;
    const names = kids(hint, "HintName").map((h) => String(leaf(h).value).toUpperCase());
    const kept = [];
    for (const name of names) {
      if (name === "INLINE" || name === "NO_INLINE") kept.push(name);
      else if (!PLAN_ONLY_HINTS.has(name)) {
        throw new BindError(`the hint ${name} has not been looked at; it is dropped or it matters, and nobody has said which`, hint);
      }
    }
    return kept.length === 0 ? undefined : kept;
  }

  function select(node) {
    if (node === undefined) throw new BindError("a SELECT was expected here and the tree has none");
    let rel;
    const from = kid(node, "Source");
    if (from !== undefined) rel = source(from);
    // `FROM a, b` -- a cross join written with a comma
    for (const extra of kids(node, "Source").slice(1)) {
      rel = join(rel, source(extra), undefined, "cross");
    }
    for (const j of kids(node, "Join")) {
      const right = source(kid(j, "Source"));
      const on = kid(j, "Condition");
      rel = join(rel, right, on === undefined ? undefined : condition(on),
        hasWord(j, "CROSS") ? "cross" : (hasWord(j, "LEFT") ? "left" : "inner"));
    }
    const where = kid(node, "Condition");
    if (where !== undefined) rel = filter(rel, condition(where));
    const items = kids(node, "SelectItem").map((item) => {
      // `*` arrives as a **word**, because the grammar matches it with
      // str(): the third time this trap has been paid for in this front end
      // (the comparison operators and the `?` placeholder were the others).
      // Looking only for an `operator` child made `SELECT *` fall through to
      // expression(undefined) and crash -- and every test used a column
      // list, so nothing covered it.
      const star = (item.children ?? []).some((c) =>
        (c.node === "operator" || c.node === "word") && c.value === "*");
      if (star) return {as: "*", expr: {node: "star"}};
      const alias = kids(item, "Name")[0];
      const expr = expression((item.children ?? []).find((c) => c.node !== "word" && c !== alias));
      return {as: alias === undefined ? (expr.name ?? "V") : nameOf(alias), expr};
    });
    // **`SELECT *` is not a projection, it is the absence of one.**
    //
    // A `project` whose only item is a star was reaching the lowering as
    // `{node:"star"}` and being refused there, which was right but late: the
    // node says "every column of the input", and the relation that already
    // means that is the input. So it collapses.
    //
    // A star **mixed with names** does not collapse and is refused by name.
    // The schema is at hand and expanding it would be easy, which is exactly
    // the trap (fable-osd): an expansion freezes the set and the order of
    // the columns at the moment of compiling, so adding a column to the
    // table later changes what the body means. That is a quiet dependency on
    // the state of the dictionary dressed up as a convenience.
    const stars = items.filter((i) => i.expr?.node === "star");
    if (stars.length > 0 && items.length > stars.length) {
      throw new BindError("`*` together with named columns is not lowered: expanding it would fix the set and the order of the columns at compile time, and a column added to the table later would change what this body means", node);
    }
    if (stars.length > 0) {
      const hinted = hintsOf(node);
      return orderAndLimit(node, hinted === undefined ? rel : {...rel, hints: hinted});
    }
    rel = project(rel, items);
    const hints = hintsOf(node);
    if (hints !== undefined) rel = {...rel, hints};
    return orderAndLimit(node, rel);
  }

  /** the ORDER BY and LIMIT that sit at the end of a SELECT -- and at the end
   *  of a whole UNION, which is where they belong to the set and not to its
   *  last branch.
   *
   *  Pulled out of select() the moment the grammar learned the second place:
   *  a trailing ORDER BY that only ONE of the two readers knew about was
   *  silently dropped, and the statement came out sorted by nothing. The
   *  end-to-end test caught it, which is the only reason this paragraph is
   *  not a bug report. A clause the parser can read and the binder cannot is
   *  worse than one neither of them has. */
  function orderAndLimit(node, input) {
    if (node === undefined) throw new BindError("an ORDER BY / LIMIT was read off a tree that is not there");
    let rel = input;
    const keys = kids(node, "OrderKey");
    if (keys.length > 0) {
      // the shape the lowering reads is {col, desc}, not {expr, dir}: the IR
      // is the contract and the parser conforms to it. Producing a
      // near-miss here would have created exactly the translation layer we
      // agreed not to build -- and it would have been found at run time, on
      // an engine, rather than here.
      rel = order(rel, keys.map((k) => {
        const e = expression(k);
        if (e.node !== "col") {
          throw new BindError("ORDER BY over an expression is not lowered yet", k);
        }
        return {col: e.name, desc: hasWord(k, "DESC")};
      }));
    }
    if (hasWord(node, "LIMIT")) {
      const after = (node.children ?? []);
      const at = after.findIndex((c) => c.node === "word" && String(c.value).toUpperCase() === "LIMIT");
      const count = after.slice(at + 1).find((c) => c.node === "Expr");
      const value = count === undefined ? undefined : expression(count);
      if (value?.node !== "lit" || typeof value.value !== "number") {
        throw new BindError("LIMIT over anything but a literal count is not lowered yet", node);
      }
      if (hasWord(node, "OFFSET")) {
        throw new BindError("LIMIT with an OFFSET is not lowered yet", node);
      }
      rel = limit(rel, value.value);
    }
    return rel;
  }

  function relation(node) {
    if (node === undefined) {
      throw new BindError("a relation was expected here and the tree has none");
    }
    const selects = kids(node, "Select");
    // the trailing ORDER BY / LIMIT belong to the set operation, not to its
    // last branch, so they are applied here and over the whole thing
    if (selects.length === 1) return orderAndLimit(node, select(selects[0]));
    const all = hasWord(node, "ALL");
    return orderAndLimit(node, union(selects.map(select), all));
  }

  // The body, statement by statement and **in order**, because an assignment
  // binds a name the statements after it may use. The grammar wraps each one
  // in a `Statement`, so the list is flattened one level -- and not deeper:
  // an assignment inside a subquery is not a statement of this body.
  // A BEGIN..END block contributes its statements to the body: the block
  // introduces no scope the lowering can see, because a table variable
  // declared inside one is still a name the statements after it use. So the
  // list is flattened through blocks as well as through Statement wrappers
  // -- and still not into a subquery, which is not a statement of this body.
  const flat = [];
  const collect = (node) => {
    for (const child of node.children ?? []) {
      if (child.node === "Statement") collect(child);
      else if (child.node === "Block") collect(child);
      else flat.push(child);
    }
  };
  collect(tree);

  const statements = [];
  let last;
  let returnedRel;
  for (const node of flat) {
    switch (node.node) {
      case "Assignment": {
        const name = nameOf(kid(node, "Name"));
        const set = kid(node, "SetOperation");
        if (set === undefined) {
          // `c_is_active := 'X';` -- an assignment to a **scalar**, which
          // this IR does not carry: it holds relations and the expressions
          // inside them. Refused by name rather than crashing three frames
          // down in `kids`, where the message named the line that fell over
          // and not the thing that was wrong.
          throw new BindError(`the assignment to ${name.toLowerCase()} is of a scalar, and this IR carries relations`, node);
        }
        const rel = relation(set);
        bound.set(name, {rel});
        statements.push({stmt: "assign", name, rel});
        break;
      }
      case "SetOperation":
        last = node;
        break;
      case "Return": {
        // `RETURN :lt;` or `RETURN SELECT ...;` -- what the body answers
        // with. Blocked 17 of the 34 bodies that parsed, which is why it is
        // the first thing lowered rather than the next thing parsed.
        const returned = kid(node, "SetOperation");
        if (returned !== undefined) {
          last = returned;
          break;
        }
        const expr = kid(node, "Expr");
        const host = expr === undefined ? undefined : (function find(n) {
          if (n.node === "host") return n;
          for (const c of n.children ?? []) {
            const got = find(c);
            if (got !== undefined) return got;
          }
          return undefined;
        })(expr);
        if (host === undefined) {
          throw new BindError("RETURN of something that is not a table variable or a select", node);
        }
        const name = String(host.value).slice(1).toUpperCase();
        const known = bound.get(name);
        if (known === undefined) {
          throw new BindError(`RETURN of an unassigned table variable :${name.toLowerCase()}`, host);
        }
        returnedRel = known.handle === undefined ? known.rel : refTo(known.handle, schemaOf(known.rel, catalogue));
        break;
      }
      case "word":
      case "operator":
        break;
      default:
        // Declare, Return, Block and the rest of the imperative shell are
        // parsed but not yet lowered. Refused by name: a body whose
        // declarations were silently dropped would run and answer something
        // plausible, which is the one outcome worse than a refusal.
        throw new BindError(`${node.node} is parsed but not lowered yet`, node);
    }
  }
  if (returnedRel !== undefined) return {statements, rel: returnedRel};
  if (last === undefined && outParam !== undefined) {
    // the body answers through its OUT table parameter: the last thing
    // assigned to it is the plan, and there is no final select because the
    // procedure does not need one
    const assigned = bound.get(String(outParam.name).toUpperCase());
    if (assigned !== undefined) return {statements, rel: assigned.rel};
  }
  if (last === undefined) throw new BindError("a body has to end in a statement that produces rows", tree);
  return {statements, rel: relation(last)};
}
