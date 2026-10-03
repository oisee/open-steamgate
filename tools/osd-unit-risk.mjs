// ABAP Unit risk follows executable method bodies, not WBCROSSGT type
// dependencies. See docs/unit-risk.md for dispatch and unknown-target policy.
import {BuiltIn, Expressions, SyntaxLogic, BasicTypes} from "@abaplint/core";
import {statementKindOf} from "./osd-unit-risk-statements.mjs";

const WRITES = {
  InsertDatabase: "INSERT",
  UpdateDatabase: "UPDATE",
  ModifyDatabase: "MODIFY",
  DeleteDatabase: "DELETE",
  Commit: "COMMIT WORK",
  Rollback: "ROLLBACK WORK",
  MergeDatabase: "MERGE",
  CommitEntities: "COMMIT ENTITIES",
  RollbackEntities: "ROLLBACK ENTITIES",
  ModifyEntities: "MODIFY ENTITIES",
  ExecSQL: "Native SQL (EXEC SQL)",
  NativeSQL: "Native SQL",
  CallDatabase: "CALL DATABASE PROCEDURE",
  SetUpdateTask: "SET UPDATE TASK LOCAL",
  CallTransaction: "CALL TRANSACTION",
  Submit: "SUBMIT",
  DeleteCluster: "DELETE FROM DATABASE",
  InsertReport: "INSERT REPORT",
  DeleteReport: "DELETE REPORT",
  InsertTextpool: "INSERT TEXTPOOL",
  DeleteTextpool: "DELETE TEXTPOOL",
};

/** One statement's verdict: the write it is, or undefined. Exported because
 *  the rule is the interesting half and needs no registry to check. */
export function writeKindOf(statementType, text, code = text) {
  if (Object.hasOwn(WRITES, statementType)) return WRITES[statementType];
  if (statementType === "Export" && /\bTO\s+DATABASE\b/i.test(code)) return "EXPORT TO DATABASE";
  if (statementType === "CallFunction") {
    if (/\bIN\s+UPDATE\s+TASK\b/i.test(code)) return "CALL FUNCTION IN UPDATE TASK";
    if (!/^CALL\s+FUNCTION\s+'/i.test(text)) return "a dynamic CALL FUNCTION";
  }
  if (statementType === "Call" && /(?:->|=>)\(|^CALL METHOD \(|\(\w+\)=>|\(\w+\)->/i.test(code)) return "a dynamic method call";
  if (statementType === "CreateObject" && /\bTYPE\s+\(/i.test(code)) return "a dynamic CREATE OBJECT";
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

const upper = (s = "") => s.toUpperCase();
const adbc = (type) => ["CL_SQL_STATEMENT", "CL_SQL_PREPARED_STATEMENT", "CL_SQL_CONNECTION"].includes(type);
const adbcOwner = (graph, owner) => {
  const seen = new Set();
  for (let c = owner; c && !seen.has(c.key); c = graph.lookup(c, c.parent)) {
    seen.add(c.key);
    if (adbc(c.name) || adbc(c.parent)) return true;
  }
  return false;
};
// Expressions contain argument literals too. Their text must never become an
// edge (for example a scanner test passing `lo->write( )` as input).
const executableText = (expression) => upper(expression.getTokens().map((token) => {
  const value = token.getStr();
  return /^['`|]/.test(value) ? " " : value;
}).join(" ")).replace(/\s*(->|=>|~)\s*/g, "$1");
const referenceTypes = (text) => new Map([...text.matchAll(/(?:VALUE\(\s*)?(<[^>]+>|[\w]+)\s*\)?\s+TYPE\s+REF\s+TO\s+([/\w]+)/g)].map((m) => [m[1], m[2]]));
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
              currentClass.at = statement;
              currentClass.file = file.getFilename().split(/[\\/]/).pop();
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
              name, file: file.getFilename().split(/[\\/]/).pop(), registryObject: object, fullFile: file.getFilename(), statements: [], types: new Map(currentClass?.signatures.get(name)), at: statement,
              amdp: /\bBY DATABASE (?:PROCEDURE|FUNCTION)\b/.test(text)};
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

  // Cache inherited lookup and compile each body once. Runtime receiver context
  // belongs to the traversal state, not the body: one inherited method can run
  // on several concrete classes with different redefinitions.
  #resolve(graph, owner, method) {
    if (!owner) return undefined;
    graph.resolved ??= new Map();
    const key = `${owner.key}:${method}`;
    if (graph.resolved.has(key)) return graph.resolved.get(key);
    let current = owner;
    const seen = new Set();
    while (current && !seen.has(current.key)) {
      seen.add(current.key);
      const found = current.methods?.get(current.aliases?.get(method) ?? method);
      if (found) { graph.resolved.set(key, found); return found; }
      current = graph.lookup(current, current.parent);
    }
    graph.resolved.set(key, undefined);
    return undefined;
  }

  #body(graph, node) {
    if (node.body) return node.body;
    const types = new Map([...node.owner.types, ...node.types]), ops = [];
    const emit = (statement, op) => ops.push({statement, ...op});
    // Native bodies have no ABAP call AST; even an empty or READ-ONLY AMDP is
    // a database escape, as are ADBC calls without available library bodies.
    if (node.amdp) emit(node.at, {action: "write", kind: "AMDP call"});
    const declaredReturn = (type, method) => {
      const owner = graph.lookup(node.owner, type);
      const target = this.#resolve(graph, owner, method);
      return target?.owner.returns.get(target.name) ?? owner?.returns?.get(method);
    };
    // Syntax scopes are lazy and cached per object; simple declared references
    // do not pay for a whole syntax pass. Complex fields use abaplint's types.
    const fieldType = (expression) => {
      const children = expression.getChildren();
      const first = children[0];
      const variable = upper(first?.concatTokens() ?? "");
      if (children.length === 1 && types.has(variable)) return types.get(variable);
      try {
        node.scope ??= new SyntaxLogic(graph.registry, node.registryObject).run().spaghetti
          .lookupPosition(node.statements[0]?.getStart() ?? node.at.getStart(), node.fullFile);
        let type = node.scope?.findVariable(variable)?.getType();
        for (const child of children.slice(1)) {
          const kind = child.get().constructor.name;
          if (kind === "TableExpression") type = type?.getRowType?.();
          else if (kind === "ComponentName") type = type?.getComponentByName?.(upper(child.concatTokens()));
          else if (kind === "AttributeName") {
            const className = type?.getIdentifierName?.();
            const owner = graph.lookup(node.owner, upper(className ?? ""));
            return owner?.types.get(upper(child.concatTokens()));
          }
        }
        return type instanceof BasicTypes.ObjectReferenceType ? upper(type.getIdentifierName()) : undefined;
      } catch { return undefined; } // caller records uncertainty, never silence
    };
    const receiverOf = (expression) => {
      const kind = expression?.get().constructor.name;
      if (kind === "NewObject") return {mode: "virtual", type: upper(expression.findDirectExpression(Expressions.TypeNameOrInfer).concatTokens())};
      if (kind === "Cast") return {mode: "virtual", type: upper(expression.findDirectExpression(Expressions.TypeNameOrInfer).concatTokens())};
      const text = upper(expression?.concatTokens() ?? "");
      if (text === "ME") return {mode: "self"};
      if (text === "SUPER") return {mode: "super"};
      if (kind === "ClassName") return {mode: "static", type: text};
      return {mode: "virtual", type: expression ? fieldType(expression) : undefined};
    };
    const chain = (expression, statement) => {
      const children = expression.getChildren();
      if (expression.get().constructor.name === "MethodSource" && children.length === 1
          && children[0].get().constructor.name === "SourceField") {
        const method = upper(children[0].concatTokens());
        emit(statement, {action: "call", mode: "self", method});
        return declaredReturn(node.owner.name, method);
      }
      let receiver = {mode: "self"}, returned;
      for (let i = 0; i < children.length; i++) {
        const child = children[i], kind = child.get().constructor.name;
        if (["ClassName", "FieldChain", "SourceField", "SourceFieldSymbol", "NewObject", "Cast"].includes(kind)) {
          receiver = receiverOf(child);
        } else if (kind === "MethodCall" || kind === "AttributeName" && i === children.length - 1) {
          const method = upper((child.findDirectExpression?.(Expressions.MethodName) ?? child).concatTokens());
          emit(statement, {action: "call", ...receiver, method});
          if (adbc(receiver.type) || adbcOwner(graph, graph.lookup(node.owner, receiver.type)))
            emit(statement, {action: "write", kind: "ADBC call"});
          returned = declaredReturn(receiver.type ?? node.owner.name, method);
          receiver = {mode: "virtual", type: returned};
        } else if (kind === "AttributeName" || kind === "ComponentName") {
          // Attributes between chained calls require a typed result. If absent,
          // the next call retains an unknown receiver and reports uncertainty.
          const owner = graph.lookup(node.owner, receiver.type);
          receiver = {mode: "virtual", type: owner?.types.get(upper(child.concatTokens()))};
        } else if (kind === "Dynamic") {
          emit(statement, {action: "unknown", reason: "a dynamic method call"});
          return undefined;
        }
      }
      return returned;
    };
    let nativeBlock = false;
    for (const statement of node.statements) {
      const text = upper(statement.concatTokens()), kind = statement.get().constructor.name;
      const executable = executableText(statement);
      const verdict = writeKindOf(kind, text, executable);
      if (verdict?.startsWith("a dynamic")) emit(statement, {action: "unknown", reason: verdict});
      // A native block/AMDP is one escape finding, not another write for
      // each parser chunk of its SQL body in addition to the entry marker.
      else if (verdict && !(kind === "NativeSQL" && (nativeBlock || node.amdp))) emit(statement, {action: "write", kind: verdict});
      if (kind === "ExecSQL") nativeBlock = true;
      if (kind === "EndExec") nativeBlock = false;
      const dynamicMethod = /(?:->|=>)\s*\(/.test(executable) || /^CALL METHOD\s+\(/.test(executable);
      if (dynamicMethod) emit(statement, {action: "unknown", reason: "a dynamic method call"});
      const classification = statementKindOf(kind);
      if (classification === "unknown" || classification === "write" && !verdict)
        emit(statement, {action: "unknown", reason: `an unknown ${kind} statement`});

      // Static component references are initialization, including constants
      // conservatively. TypeName nodes are declarations, not executable access.
      const scanStatic = (expression) => {
        if (expression.get().constructor.name === "TypeName") return;
        const children = expression.getChildren?.() ?? [];
        for (let i = 0; i < children.length; i++) {
          if (children[i].get().constructor.name === "StaticArrow") {
            const previous = children[i - 1];
            if (previous?.get().constructor.name === "ClassName")
              emit(statement, {action: "init", type: upper(previous.concatTokens())});
            else emit(statement, {action: "unknown", reason: "an unresolved static access"});
          }
          if (children[i].getChildren) scanStatic(children[i]);
        }
      };
      scanStatic(statement);
      if (kind === "CreateObject" && !verdict?.startsWith("a dynamic")) {
        const target = statement.findDirectExpression(Expressions.Target);
        const name = statement.findDirectExpression(Expressions.ClassName)?.concatTokens();
        const variable = upper(target?.concatTokens() ?? "");
        const type = name ? upper(name) : types.get(variable);
        emit(statement, {action: "new", type});
        if (type && !types.has(variable)) types.set(variable, type);
      }
      // RAISE ... TYPE constructs an exception; RAISE an existing reference
      // does not. SHORTDUMP and RESUMABLE share this parser kind and path.
      if (kind === "Raise" && /\b(?:EXCEPTION|SHORTDUMP)\s+TYPE\b/.test(executable))
        emit(statement, {action: "new", type: upper(statement.findDirectExpression(Expressions.ClassName)?.concatTokens())});
      for (const expression of statement.findAllExpressions(Expressions.Throw))
        emit(statement, {action: "new", type: upper(expression.findDirectExpression(Expressions.ClassName)?.concatTokens())});
      const variable = executable.match(/^(?:DATA\(\s*)?(\w+)\s*\)?\s*=/)?.[1];
      for (const expression of statement.findAllExpressions(Expressions.NewObject)) {
        const name = upper(expression.findDirectExpression(Expressions.TypeNameOrInfer).concatTokens());
        const type = name === "#" ? types.get(variable) : name;
        // NEW can construct data as well as objects. Known data types do not
        // execute constructors; unknown object/data targets remain uncertain.
        if (graph.lookup(node.owner, type) || !BuiltIn.searchBuiltin(type ?? "")) emit(statement, {action: "new", type});
        if (variable && type && !types.has(variable)) types.set(variable, type);
      }
      if (kind === "CallFunction") {
        const name = text.match(/^CALL FUNCTION\s+'([^']+)'/)?.[1];
        if (name) emit(statement, {action: "function", name});
      }
      const expressions = [...statement.findAllExpressions(Expressions.MethodCallChain), ...statement.findAllExpressions(Expressions.MethodSource)];
      for (const expression of expressions) {
        const result = chain(expression, statement);
        if (variable && result && !types.has(variable)) types.set(variable, result);
      }
      // Parser recovery must not turn an unsupported CALL into no edges.
      if (kind === "Call" && expressions.length === 0 && !dynamicMethod)
        emit(statement, {action: "unknown", reason: "an unresolved method call"});
    }
    node.body = ops;
    return ops;
  }

  /** A worklist of (body, runtime receiver) states. A new concrete class only
   * wakes calls indexed by its ancestors/interfaces; no repeated whole-graph
   * scans. Paths use linked predecessors so long chains are linear too. */
  async writesReached(objectName, {limit = 5} = {}) {
    const graph = this.#graph(), start = upper(String(objectName));
    const reached = new Map(), states = new Set(), queue = [], objects = new Set([start]);
    const instantiated = new Set(), candidates = new Map(), callers = new Map();
    const writes = new Map(), unknown = new Map(), waiting = [];
    const link = (prev, at) => ({prev, at});
    const pathOf = (path) => { const out = []; for (; path; path = path.prev) out.push(path.at); return out.reverse(); };
    const add = (node, runtime, path, site) => {
      if (!node) return;
      const key = `${node.key}:${runtime?.key ?? "static"}`;
      if (states.has(key)) return;
      states.add(key);
      const next = link(path, {...location(node, node.at), ...(site ? {callSite: site} : {})});
      if (!reached.has(node.key)) reached.set(node.key, next);
      objects.add(node.object);
      queue.push({node, runtime, path: next});
    };
    const uncertain = (node, statement, path, reason) => {
      const at = location(node, statement), key = `${node.key}:${at.line}:${at.column}`;
      // One finding per source statement, preferring the dynamic explanation.
      if (!unknown.has(key) || reason.includes("dynamic")) unknown.set(key, {...at, kind: reason, path: link(path, at)});
    };
    const lineage = (owner) => {
      if (owner.lineage) return owner.lineage;
      const out = [], seen = new Set();
      for (let c = owner; c && !seen.has(c.key); c = graph.lookup(c, c.parent)) { seen.add(c.key); out.push(c); }
      owner.lineage = out;
      return out;
    };
    const typeKey = (owner, name) => graph.lookup(owner, name)?.key ?? name;
    const initialize = (owner, state, statement, instance = false) => {
      if (!owner) { uncertain(state.node, statement, state.path, "an unresolved construction or static access"); return; }
      for (const c of [...lineage(owner)].reverse()) {
        for (const method of instance ? ["CLASS_CONSTRUCTOR", "CONSTRUCTOR"] : ["CLASS_CONSTRUCTOR"]) {
          const target = c.methods?.get(method);
          add(target, method === "CONSTRUCTOR" ? owner : undefined, state.path, location(state.node, statement));
          if (!target && c.signatures?.has(method))
            uncertain(state.node, statement, state.path, "an unresolved initialization method");
        }
        if (c.parent && !graph.lookup(c, c.parent)) uncertain(state.node, statement, state.path, "an unresolved superclass initialization");
      }
    };
    const call = (owner, method, state, statement, runtime = owner) => {
      if (adbcOwner(graph, owner)) {
        const at = location(state.node, statement);
        writes.set(`${state.node.key}:${at.line}:${at.column}`, {...at, kind: "ADBC call", path: link(state.path, at)});
      }
      const target = this.#resolve(graph, owner, method);
      if (target) add(target, runtime, state.path, location(state.node, statement));
      else if (!["CONSTRUCTOR", "CLASS_CONSTRUCTOR"].includes(method)) uncertain(state.node, statement, state.path, "an unresolved method call");
      initialize(owner, state, statement);
    };
    const dispatch = (subscription, owner) => {
      const {op, state} = subscription;
      const qualified = `${op.type}~${op.method}`;
      call(owner, this.#resolve(graph, owner, qualified) ? qualified : op.method, state, op.statement, owner);
      subscription.matched = true;
    };
    const instantiate = (owner, state, statement) => {
      initialize(owner, state, statement, true);
      if (!owner || instantiated.has(owner.key)) return;
      instantiated.add(owner.key);
      const keys = new Set();
      for (const c of lineage(owner)) {
        keys.add(c.key);
        for (const intf of c.interfaces) keys.add(intf);
      }
      for (const key of keys) {
        if (!candidates.has(key)) candidates.set(key, new Set());
        candidates.get(key).add(owner);
        for (const subscriber of callers.get(key) ?? []) dispatch(subscriber, owner);
      }
    };
    const roots = [...graph.classes.values()].filter((c) => c.object === start && c.testing);
    for (const c of roots) {
      const rootNode = c.methods.values().next().value ?? {key: `${c.key}:<TEST>`, owner: c,
        object: c.object, className: c.name, name: "<TEST>", file: c.file, at: c.at};
      const state = {node: rootNode, runtime: c};
      instantiate(c, state, rootNode.at);
      for (const name of [...(c.tests ?? []), "SETUP", "TEARDOWN", "CLASS_SETUP", "CLASS_TEARDOWN"]) {
        const target = this.#resolve(graph, c, name);
        add(target, c);
        if (!target && (c.tests?.has(name) || c.signatures.has(name)))
          uncertain(rootNode, rootNode.at, undefined, "an unresolved test method");
      }
    }
    for (let next = 0; next < queue.length; next++) {
      const state = queue[next], {node, runtime, path} = state;
      for (const op of this.#body(graph, node)) {
        const {statement} = op;
        if (op.action === "write") {
          const at = location(node, statement);
          writes.set(`${node.key}:${at.line}:${at.column}`, {...at, kind: op.kind, path: link(path, at)});
        } else if (op.action === "unknown") uncertain(node, statement, path, op.reason);
        else if (op.action === "init") initialize(graph.lookup(node.owner, op.type), state, statement);
        else if (op.action === "new") instantiate(graph.lookup(node.owner, op.type), state, statement);
        else if (op.action === "function") {
          const target = graph.functions.get(op.name);
          if (target) add(target, undefined, path, location(node, statement));
          else uncertain(node, statement, path, "an unresolved function call");
        } else if (op.mode === "static") call(graph.lookup(node.owner, op.type), op.method, state, statement, undefined);
        else if (op.mode === "super") call(graph.lookup(node.owner, node.owner.parent), op.method, state, statement, runtime);
        else if (op.mode === "self") {
          if (this.#resolve(graph, runtime ?? node.owner, op.method) || !BuiltIn.searchBuiltin(op.method))
            call(runtime ?? node.owner, op.method, state, statement, runtime);
        } else if (!op.type || op.type === "#") uncertain(node, statement, path, "an unresolved virtual call");
        else {
          const key = typeKey(node.owner, op.type), subscription = {op, state, matched: false};
          if (!callers.has(key)) callers.set(key, []);
          callers.get(key).push(subscription);
          waiting.push(subscription);
          for (const owner of candidates.get(key) ?? []) dispatch(subscription, owner);
        }
      }
    }
    for (const {op, state, matched} of waiting) if (!matched) uncertain(state.node, op.statement, state.path, "an unresolved virtual call");
    const findings = (map) => [...map.values()].slice(0, limit).map((finding) => ({...finding, path: pathOf(finding.path)}));
    return {writes: findings(writes), total: writes.size,
      dynamicCalls: findings(unknown), dynamicCallsTotal: unknown.size, reached: objects.size};
  }
}
