// ABAP Unit risk follows executable method bodies, not WBCROSSGT type
// dependencies. See docs/unit-risk.md for dispatch and unknown-target policy.
import {BuiltIn, Expressions} from "@abaplint/core";

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

const upper = (s) => s.toUpperCase();
// Expressions contain argument literals too. Their text must never become an
// edge (for example a scanner test passing `lo->write( )` as input).
const executableText = (expression) => upper(expression.getTokens().map((token) => {
  const value = token.getStr();
  return /^['`|]/.test(value) ? " " : value;
}).join(" ")).replace(/\s*(->|=>|~)\s*/g, "$1");
const referenceTypes = (text) => new Map([...text.matchAll(/(?:VALUE\(\s*)?([\w]+)\s*\)?\s+TYPE\s+REF\s+TO\s+([/\w]+)/g)].map((m) => [m[1], m[2]]));
const location = (node, statement) => ({object: node.object, method: `${node.className}=>${node.name}`,
  file: node.file, line: statement.getStart().getRow(), column: statement.getStart().getCol()});

export class UnitRisk {
  constructor(store) { this.store = store; }

  #graph() {
    const registry = this.store.registry();
    if (this.graph?.registry === registry) return this.graph;
    const classes = new Map(), nodes = new Map(), functions = new Map();
    const classKey = (object, name) => `${object}:${name}`;
    for (const object of registry.getObjects()) {
      const objectName = upper(object.getName());
      let currentClass, currentNode;
      for (const file of object.getABAPFiles?.() ?? []) {
        for (const statement of file.getStatements()) {
          const text = upper(statement.concatTokens());
          const kind = statement.get().constructor.name;
          if (kind === "ClassDefinition" || kind === "ClassImplementation") {
            const name = text.match(/^CLASS\s+(\S+)/)?.[1];
            const key = classKey(objectName, name);
            currentClass = classes.get(key) ?? {key, name, object: objectName, types: new Map(), methods: new Map(), signatures: new Map(), returns: new Map(), aliases: new Map(), interfaces: []};
            classes.set(key, currentClass);
            if (kind === "ClassDefinition") {
              currentClass.parent = text.match(/INHERITING FROM\s+([^ .]+)/)?.[1];
              currentClass.testing = /FOR TESTING/.test(text);
            }
          } else if (kind === "EndClass") {
            currentClass = undefined;
          } else if (kind === "InterfaceDef" && currentClass) {
            currentClass.interfaces.push(text.match(/^INTERFACES\s+([^ .]+)/)?.[1]);
          } else if (kind === "Aliases" && currentClass) {
            const alias = text.match(/^ALIASES\s+(\w+)\s+FOR\s+([/\w~]+)/);
            if (alias) currentClass.aliases.set(alias[1], alias[2]);
          } else if (kind === "MethodDef" && currentClass) {
            const methodName = text.match(/^(?:CLASS-)?METHODS\s+([^ .]+)/)?.[1];
            currentClass.signatures.set(methodName, referenceTypes(text));
            const returning = text.match(/RETURNING\s+VALUE\(\s*\w+\s*\)\s+TYPE REF TO\s+([/\w]+)/);
            if (returning) currentClass.returns.set(methodName, returning[1]);
            if (/FOR TESTING/.test(text)) {
              currentClass.tests ??= new Set();
              currentClass.tests.add(text.match(/^(?:CLASS-)?METHODS\s+([^ .]+)/)?.[1]);
            }
          } else if (kind === "MethodImplementation" || kind === "FunctionModule") {
            const name = text.match(/^(?:METHOD|FUNCTION)\s+([^ .]+)/)?.[1];
            const owner = currentClass ?? {key: classKey(objectName, objectName), name: objectName, object: objectName, types: new Map()};
            currentNode = {key: `${owner.key}:${name}`, object: objectName, className: owner.name, owner,
              name, file: file.getFilename().split(/[\\/]/).pop(), statements: [], types: new Map(currentClass?.signatures.get(name)), at: statement};
            nodes.set(currentNode.key, currentNode);
            if (currentClass) currentClass.methods.set(name, currentNode);
            else functions.set(name, currentNode);
          } else if (kind === "EndMethod" || kind === "EndFunction") {
            currentNode = undefined;
          } else {
            if (currentNode) currentNode.statements.push(statement);
            const types = currentNode?.types ?? currentClass?.types;
            if (types) for (const [variable, type] of referenceTypes(text)) types.set(variable, type);
          }
        }
      }
    }
    const globals = new Map([...classes.values()].filter((c) => c.object === c.name).map((c) => [c.name, c]));
    const lookup = (owner, name) => classes.get(classKey(owner.object, name)) ?? globals.get(name);
    this.graph = {registry, classes, nodes, functions, lookup};
    return this.graph;
  }

  /** Fixed point: factories reached through calls contribute their NEW / CREATE
   * targets before interface dispatch is repeated. Unknown receivers never
   * expand to all implementers; they produce a separate uncertainty instead. */
  async writesReached(objectName, {limit = 5} = {}) {
    const graph = this.#graph(), start = upper(String(objectName));
    const reached = new Map(), instantiated = new Set();
    const roots = [...graph.classes.values()].filter((c) => c.object === start && c.testing);
    const add = (node, path = [], at) => {
      if (!node || reached.has(node.key)) return false;
      reached.set(node.key, [...path, at ?? location(node, node.at)]);
      return true;
    };
    const resolve = (owner, method, visited = new Set()) => {
      if (!owner || visited.has(owner.key)) return undefined;
      visited.add(owner.key);
      return owner.methods.get(owner.aliases.get(method) ?? method) ?? resolve(graph.lookup(owner, owner.parent), method, visited);
    };
    const isA = (candidate, target, visited = new Set()) => {
      if (!candidate || visited.has(candidate.key)) return false;
      visited.add(candidate.key);
      return candidate.name === target || candidate.interfaces.includes(target)
        || isA(graph.lookup(candidate, candidate.parent), target, visited);
    };
    for (const c of roots) {
      instantiated.add(c.key);
      for (const name of [...(c.tests ?? []), "SETUP", "TEARDOWN", "CLASS_SETUP", "CLASS_TEARDOWN", "CONSTRUCTOR", "CLASS_CONSTRUCTOR"]) add(resolve(c, name));
    }
    let changed = true;
    let unknown = new Map();
    while (changed) {
      changed = false;
      unknown = new Map();
      for (const [key, path] of reached) {
        const node = graph.nodes.get(key);
        const types = new Map([...node.owner.types, ...node.types]);
        const uncertain = (statement, reason) => {
          const at = location(node, statement);
          unknown.set(`${key}:${at.line}:${at.column}:${reason}`, {...at, kind: reason, path: [...path, at]});
        };
        const call = (owner, method, statement) => {
          const target = resolve(owner, method);
          if (target) changed = add(target, path, {...location(target, target.at), callSite: location(node, statement)}) || changed;
          else if (!["CONSTRUCTOR", "CLASS_CONSTRUCTOR"].includes(method)) uncertain(statement, "an unresolved method call");
          // An inherited class constructor can execute before any static call.
          const init = resolve(owner, "CLASS_CONSTRUCTOR");
          if (init && init !== target) changed = add(init, path, {...location(init, init.at), callSite: location(node, statement)}) || changed;
        };
        const instantiate = (name, statement) => {
          const owner = graph.lookup(node.owner, name);
          if (!owner) { uncertain(statement, "an unresolved construction"); return; }
          if (!instantiated.has(owner.key)) { instantiated.add(owner.key); changed = true; }
          call(owner, "CONSTRUCTOR", statement);
        };
        for (const statement of node.statements) {
          const text = upper(statement.concatTokens()), kind = statement.get().constructor.name;
          const executable = executableText(statement);
          const verdict = writeKindOf(kind, kind === "Call" ? executable : text);
          if (verdict?.startsWith("a dynamic")) uncertain(statement, verdict);
          // Some dynamic expressions have no MethodCallChain in the parser.
          // Token evidence still establishes uncertainty, never a concrete edge.
          if (/(?:->|=>)\s*\(/.test(executable)) uncertain(statement, "a dynamic method call");
          const assignment = executableText(statement).match(/^(?:DATA\(\s*)?(\w+)\s*\)?\s*=\s*([/\w]+)=>([/\w~]+)\s*\(/);
          if (assignment && !types.has(assignment[1])) {
            const factory = graph.lookup(node.owner, assignment[2]);
            const returnType = factory?.returns.get(assignment[3]);
            if (returnType) types.set(assignment[1], returnType);
          }
          if (kind === "CreateObject" && !verdict?.startsWith("a dynamic")) {
            const m = text.match(/^CREATE OBJECT\s+(\w+)(?:\s+TYPE\s+([/\w]+))?/);
            if (m) { const name = m[2] ?? types.get(m[1]); if (name) { if (!types.has(m[1])) types.set(m[1], name); instantiate(name, statement); } else uncertain(statement, "an unresolved construction"); }
          }
          for (const expression of statement.findAllExpressions(Expressions.NewObject)) {
            const name = upper(expression.concatTokens()).match(/^NEW\s+([/\w]+|#)/)?.[1];
            const variable = text.match(/^(?:DATA\(\s*)?(\w+)\s*\)?\s*=/)?.[1];
            const concrete = name === "#" ? types.get(variable) : name;
            if (concrete) { if (variable && !types.has(variable)) types.set(variable, concrete); instantiate(concrete, statement); }
            else uncertain(statement, "an unresolved construction");
          }
          if (kind === "CallFunction") {
            const name = text.match(/^CALL FUNCTION\s+'([^']+)'/)?.[1];
            if (name) {
              const target = graph.functions.get(name);
              if (target) changed = add(target, path, {...location(target, target.at), callSite: location(node, statement)}) || changed;
              else uncertain(statement, "an unresolved function call");
            }
          }
          const expressions = [...statement.findAllExpressions(Expressions.MethodCallChain), ...statement.findAllExpressions(Expressions.MethodSource)];
          for (const expression of expressions) {
            const source = executableText(expression);
            if (/(?:->|=>)\s*\(/.test(source)) { uncertain(statement, "a dynamic method call"); continue; }
            const newChain = source.match(/^NEW\s+([/\w]+)\s*\([^)]*\)\s*->\s*([/\w~]+)\s*\(/);
            if (newChain) call(graph.lookup(node.owner, newChain[1]), newChain[2], statement);
            if (/\)\s*->/.test(source) && !newChain) uncertain(statement, "an unresolved virtual call");
            const qualified = [...source.matchAll(/([/\w]+)\s*(=>|->)\s*([/\w~]+)(?=\s*\(|\s*$)/g)];
            if (qualified.length === 0) {
              const method = source.match(/^([\w~]+)(?:\s*\(|\s*$)/)?.[1];
              if (method && (resolve(node.owner, method) || !BuiltIn.searchBuiltin(method))) call(node.owner, method, statement);
            }
            for (const [, receiver, arrow, method] of qualified) {
              if (arrow === "=>") { call(graph.lookup(node.owner, receiver), method, statement); continue; }
              if (receiver === "SUPER") { call(graph.lookup(node.owner, node.owner.parent), method, statement); continue; }
              const type = receiver === "ME" ? node.owner.name : types.get(receiver);
              const candidates = [...instantiated].map((k) => graph.classes.get(k)).filter((c) => type && isA(c, type));
              if (candidates.length === 0) { uncertain(statement, "an unresolved virtual call"); continue; }
              for (const c of candidates) call(c, resolve(c, `${type}~${method}`) ? `${type}~${method}` : method, statement);
            }
          }
        }
      }
    }
    const writes = new Map();
    for (const [key, path] of reached) {
      const node = graph.nodes.get(key);
      for (const statement of node.statements) {
        const kind = writeKindOf(statement.get().constructor.name, statement.concatTokens());
        if (kind && !kind.startsWith("a dynamic")) {
          const at = location(node, statement);
          writes.set(`${key}:${at.line}:${at.column}:${kind}`, {...at, kind, path: [...path, at]});
        }
      }
    }
    return {writes: [...writes.values()].slice(0, limit), total: writes.size,
      dynamicCalls: [...unknown.values()].slice(0, limit), dynamicCallsTotal: unknown.size,
      reached: new Set([start, ...[...reached.keys()].map((k) => graph.nodes.get(k).object)]).size};
  }
}
