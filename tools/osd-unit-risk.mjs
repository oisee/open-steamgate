// What an ABAP Unit test class says about itself, checked against what it
// reaches.
//
// A test class declares `RISK LEVEL HARMLESS | DANGEROUS | CRITICAL`, and a
// system trusts it: the client setting only says which levels may run
// there. The Test Explorer schedules on the declaration (HARMLESS in
// parallel, the rest one at a time), so a declaration that is wrong is a
// race between two tests on one database. This is the check that does not
// trust it: from the cross-reference (tools/osd-xref-seed.mjs rows -- the
// same WBCROSSGT/CROSS a system keeps), every object a test's own object
// reaches, and in each the statements that write:
//
//   INSERT/UPDATE/MODIFY/DELETE on a database table, COMMIT WORK,
//   CALL FUNCTION ... IN UPDATE TASK, and a call this cannot follow
//   (a dynamic CALL METHOD, CREATE OBJECT ... TYPE (name), CALL FUNCTION
//   with a name that is not a literal).
//
// **Object-level, on purpose, and so conservative.** The cross-reference is
// per object, not per method: a test that calls one read method of a class
// with a write method elsewhere is flagged. Measured on this tree
// (2026-09-28): 14 of the 23 objects with tests reach a write or a dynamic
// call, several of them rightly (their tests insert rows); the other 9 run
// in parallel. A flag costs parallelism, never correctness, and the
// runtime guard (tools/osd-unit.mjs) catches a write this misses.
import {rows} from "./osd-xref-seed.mjs";

const WRITES = {
  InsertDatabase: "INSERT",
  UpdateDatabase: "UPDATE",
  ModifyDatabase: "MODIFY",
  DeleteDatabase: "DELETE",
  Commit: "COMMIT WORK",
};

/** One statement's verdict: the write it is, or undefined. Exported because
 *  the rule is the interesting half and needs no registry to check. */
export function writeKindOf(statementType, text) {
  if (WRITES[statementType] !== undefined) return WRITES[statementType];
  if (statementType === "CallFunction") {
    if (/\bIN\s+UPDATE\s+TASK\b/i.test(text)) return "CALL FUNCTION IN UPDATE TASK";
    if (!/^CALL\s+FUNCTION\s+'/i.test(text)) return "a dynamic CALL FUNCTION";
  }
  if (statementType === "Call" && /(?:->|=>)\(|^CALL METHOD \(|\(\w+\)=>|\(\w+\)->/i.test(text)) return "a dynamic method call";
  if (statementType === "CreateObject" && /\bTYPE\s+\(/i.test(text)) return "a dynamic CREATE OBJECT";
  return undefined;
}

/** The risk a test class is scheduled with: what it declares, except that
 *  a class declaring nothing is DANGEROUS (ADT reports it as harmless; a
 *  scheduler that believes that runs unknown tests in parallel), and a
 *  HARMLESS class whose object reaches a write is DANGEROUS too. */
export function scheduledRisk(testClass, writes = []) {
  if (testClass.riskLevelDeclared !== true) return "dangerous";
  if (testClass.riskLevel === "harmless" && writes.length > 0) return "dangerous";
  return testClass.riskLevel;
}

export class UnitRisk {
  constructor(store) {
    this.store = store;
  }

  // the graph once per registry: edges object -> object from the
  // cross-reference, a function module to its group, an interface to the
  // classes that implement it (a call through the interface reaches them)
  async #graph() {
    const registry = this.store.registry();
    if (this.graph?.registry === registry) return this.graph;
    const tables = await rows(this.store.root);
    const byName = new Map();
    const groupOf = new Map();
    const implementers = new Map();
    for (const object of registry.getObjects()) {
      const name = object.getName().toUpperCase();
      byName.set(name, object);
      if (object.getType() === "FUGR" && typeof object.getModules === "function") {
        for (const module of object.getModules()) groupOf.set(module.getName().toUpperCase(), name);
      }
      if (object.getType() === "CLAS" && typeof object.getClassDefinition === "function") {
        for (const implemented of object.getClassDefinition()?.interfaces ?? []) {
          const key = implemented.name.toUpperCase();
          if (!implementers.has(key)) implementers.set(key, []);
          implementers.get(key).push(name);
        }
      }
    }
    const edges = new Map();
    const add = (from, to) => {
      if (from === to || !byName.has(from) || !byName.has(to)) return;
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from).add(to);
    };
    for (const row of tables.WBCROSSGT ?? []) add(row.INCLUDE, String(row.NAME).split("\\")[0]);
    for (const row of tables.CROSS ?? []) {
      if (row.TYPE === "F" && groupOf.has(row.NAME)) add(row.INCLUDE, groupOf.get(row.NAME));
    }
    for (const [intf, classes] of implementers) for (const name of classes) add(intf, name);
    this.graph = {registry, byName, edges, writes: new Map()};
    return this.graph;
  }

  #writesIn(graph, name) {
    if (graph.writes.has(name)) return graph.writes.get(name);
    const found = [];
    for (const file of graph.byName.get(name)?.getABAPFiles?.() ?? []) {
      for (const statement of file.getStatements()) {
        const kind = writeKindOf(statement.get().constructor.name, statement.concatTokens());
        if (kind !== undefined) {
          found.push({object: name, kind, file: file.getFilename().split(/[\\/]/).pop(), line: statement.getStart().getRow()});
        }
      }
    }
    graph.writes.set(name, found);
    return found;
  }

  /** The writes an object's tests can reach: the first `limit` of them, and
   *  how many there are. The object's own statements come first, so the
   *  test's own INSERT is named before a class three calls away. */
  async writesReached(objectName, {limit = 5} = {}) {
    const graph = await this.#graph();
    const start = String(objectName).toUpperCase();
    const seen = new Set([start]);
    const queue = [start];
    const found = [];
    while (queue.length > 0) {
      const name = queue.shift();
      found.push(...this.#writesIn(graph, name));
      for (const next of graph.edges.get(name) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return {writes: found.slice(0, limit), total: found.length, reached: seen.size};
  }
}
