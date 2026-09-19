// Stage 2 of the SQLScript front end: the combinators the grammar is written
// in, in the shape of abaplint's `combi.ts`.
//
// A grammar here is **data, not code**: one class per construct, one method
// returning what it matches, built out of `seq`, `alt`, `opt`, `star` and the
// rest. Nothing walks the source with a regular expression; a `tok` matcher
// sees exactly one token, which is the rule that keeps this from becoming the
// kind of string surgery this project has twice paid for.
//
// The matching model is abaplint's: a matcher takes a position in the token
// stream and returns **every** position it could reach, so alternatives are
// explored rather than committed to. `altPrio` commits to the first branch
// that matches, which is how a grammar stays fast where it is unambiguous.
//
// What comes out is a syntax tree whose node names mirror
// tools/sqlscript-ir.mjs where they correspond -- `filter`, `project`,
// `join`, `col`, `lit`. The IR is **typed** and a parser cannot know types,
// so a separate stage adds them (docs/sqlscript-parser-style.md). Mirroring
// the names means that stage is a walk that annotates, not a translation
// between two shapes -- and a translation is where two shapes disagree.

import {TokenKind} from "./lexer.mjs";

/** what a matcher returns: the positions it could reach, with what it built */
const reach = (index, nodes) => ({index, nodes});

/** the base every construct extends */
export class Expression {
  /** @returns {{match: (tokens: any[], index: number) => any[]}} */
  getRunnable() {
    throw new Error(`${this.constructor.name} has no getRunnable()`);
  }
  get name() {
    return this.constructor.name;
  }
  match(tokens, index) {
    const inner = this.getRunnable().match(tokens, index);
    return inner.map((r) => reach(r.index, [{node: this.name, children: r.nodes,
      line: tokens[index]?.line, col: tokens[index]?.col}]));
  }
}

/** a literal word, matched without regard to case -- SQL keywords are words */
export function str(word) {
  const wanted = word.toUpperCase();
  return {
    match(tokens, index) {
      const t = tokens[index];
      if (t === undefined) return [];
      const same = (t.kind === TokenKind.identifier || t.kind === TokenKind.operator)
        && String(t.value).toUpperCase() === wanted;
      return same ? [reach(index + 1, [{node: "word", value: t.value, line: t.line, col: t.col}])] : [];
    },
    describe: () => word,
  };
}

/** one token of a kind, optionally matching a pattern -- **one token, never a span** */
export function tok(kind, pattern) {
  return {
    match(tokens, index) {
      const t = tokens[index];
      if (t === undefined || t.kind !== kind) return [];
      if (pattern !== undefined && !pattern.test(String(t.value))) return [];
      return [reach(index + 1, [{node: kind, value: t.value, line: t.line, col: t.col}])];
    },
    describe: () => kind,
  };
}

const runnableOf = (part) => (typeof part === "string" ? str(part)
  : (part instanceof Expression ? {match: (t, i) => part.match(t, i), describe: () => part.name} : part));

/** one after another */
export function seq(...parts) {
  const runnables = parts.map(runnableOf);
  return {
    match(tokens, index) {
      let states = [reach(index, [])];
      for (const r of runnables) {
        const next = [];
        for (const s of states) {
          for (const got of r.match(tokens, s.index)) {
            next.push(reach(got.index, s.nodes.concat(got.nodes)));
          }
        }
        if (next.length === 0) return [];
        states = next;
      }
      return states;
    },
    describe: () => runnables.map((r) => r.describe()).join(" "),
  };
}

/** any of them, all explored */
export function alt(...parts) {
  const runnables = parts.map(runnableOf);
  return {
    match(tokens, index) {
      return runnables.flatMap((r) => r.match(tokens, index));
    },
    describe: () => runnables.map((r) => r.describe()).join(" | "),
  };
}

/** the first that matches, and no other tried -- for a grammar that is not
 *  ambiguous there, which is most of it */
export function altPrio(...parts) {
  const runnables = parts.map(runnableOf);
  return {
    match(tokens, index) {
      for (const r of runnables) {
        const got = r.match(tokens, index);
        if (got.length > 0) return got;
      }
      return [];
    },
    describe: () => runnables.map((r) => r.describe()).join(" / "),
  };
}

/** none or one */
export function opt(part) {
  const r = runnableOf(part);
  return {
    match(tokens, index) {
      return [reach(index, []), ...r.match(tokens, index)];
    },
    describe: () => `[${r.describe()}]`,
  };
}

/** none or more */
export function star(part) {
  const r = runnableOf(part);
  return {
    match(tokens, index) {
      const out = [reach(index, [])];
      let states = [reach(index, [])];
      for (;;) {
        const next = [];
        for (const s of states) {
          for (const got of r.match(tokens, s.index)) {
            if (got.index === s.index) continue;   // no progress: stop, or loop for ever
            next.push(reach(got.index, s.nodes.concat(got.nodes)));
          }
        }
        if (next.length === 0) break;
        out.push(...next);
        states = next;
      }
      return out;
    },
    describe: () => `{${r.describe()}}`,
  };
}

/** one or more */
export function plus(part) {
  const r = runnableOf(part);
  return seq(r, star(r));
}

/** a construct only some engines have. The dialect lives **in the grammar**,
 *  not in a branch in a generator downstream, which is where dialect handling
 *  goes to die (docs/sqlscript-parser-style.md). */
export function ver(engines, part) {
  const r = runnableOf(part);
  return {
    match(tokens, index) {
      const engine = ver.engine;
      if (engine !== undefined && !engines.includes(engine)) return [];
      return r.match(tokens, index);
    },
    describe: () => `${engines.join("/")}:${r.describe()}`,
  };
}
/** which engine the grammar is being read for; undefined means "all of them" */
ver.engine = undefined;

export class ParseError extends Error {
  constructor(message, token) {
    const where = token === undefined ? "at the end of the body" : `line ${token.line} col ${token.col}`;
    super(`${message}: ${where}`);
    this.line = token?.line;
    this.col = token?.col;
  }
}

/** Run a construct against a whole token stream, and insist it consumed it.
 *
 *  A parser that quietly matches a prefix is the same defect as a scan that
 *  reads nothing and prints the clean line: it looks like success. So the
 *  refusal names the token it stopped at, with line and column, the way the
 *  engine does.
 */
export function parse(expression, tokens) {
  const results = expression.match(tokens, 0).filter((r) => r.index === tokens.length);
  if (results.length === 0) {
    // the furthest any alternative reached is the most useful place to point
    const all = expression.match(tokens, 0);
    const furthest = all.reduce((best, r) => (r.index > best ? r.index : best), 0);
    throw new ParseError(`cannot parse ${expression.name ?? "input"}`, tokens[furthest]);
  }
  return results[0].nodes[0];
}
