// Bind the imperative SQLScript syntax tree to the portable procedure IR.
//
// Statement ownership lives here; expressions and relations deliberately go
// through the established relational binder in to-ir.mjs. That keeps one
// implementation of SQLScript typing and one list of explicit refusals.
import {T, lit, scan, project, union, schemaOf} from "./sqlscript-ir.mjs";
import {toIr, BindError} from "./sqlscript/to-ir.mjs";
import {lex} from "./sqlscript/lexer.mjs";
import {parse} from "./sqlscript/combi.mjs";
import {Body} from "./sqlscript/expressions/index.mjs";
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop,
  ifElse, callProcedure, UnsupportedSqlScript} from "./sqlscript-procedure-ir.mjs";

const upper = (value) => String(value).toUpperCase();
const children = (node, kind) => (node.children ?? []).filter((one) => one.node === kind);
const child = (node, kind) => children(node, kind)[0];
const leaf = (node) => {
  if (node?.value !== undefined) return node;
  for (const one of node?.children ?? []) {
    const found = leaf(one);
    if (found !== undefined) return found;
  }
};
const nameOf = (node) => upper(leaf(node)?.value ?? "");
const exactWrapped = (node, kind) => {
  let current = node;
  while (current !== undefined && current.node !== kind) {
    if (!["Expr", "Term", "Factor"].includes(current.node)) return undefined;
    const semantic = (current.children ?? []).filter((one) => one.node !== "word");
    if (semantic.length !== 1) return undefined;
    current = semantic[0];
  }
  return current;
};
const terminalLeaves = (node, found = []) => {
  if (node?.value !== undefined) found.push(node);
  else for (const one of node?.children ?? []) terminalLeaves(one, found);
  return found;
};
const isBareNull = (node) => {
  const leaves = terminalLeaves(node);
  return leaves.length === 1 && leaves[0].node === "identifier" && upper(leaves[0].value) === "NULL";
};

export function irTypeFromAbap(type) {
  const text = upper(type).trim();
  if (["I", "INT4", "INTEGER"].includes(text)) return T.int;
  if (["STRING", "SSTRING"].includes(text)) return T.str;
  if (["D", "DATS"].includes(text)) return T.char(8);
  if (["T", "TIMS"].includes(text)) return T.char(6);
  const length = /^(?:C\s+LENGTH\s+|CHAR)(\d+)$/.exec(text)?.[1];
  if (length !== undefined) return T.char(Number(length));
  const packed = /^P(?:\s+LENGTH\s+(\d+))?(?:\s+DECIMALS\s+(\d+))?$/.exec(text);
  if (packed !== null) return T.dec(Number(packed[1] ?? 16), Number(packed[2] ?? 2));
  throw new UnsupportedSqlScript(`ABAP type ${type || "<empty>"} has no portable SQLScript mapping`);
}

function structuredTable(abapType, types) {
  const table = types.get(upper(abapType));
  const row = table?.kind === "table" ? types.get(table.of) : undefined;
  if (row?.kind !== "structure") return undefined;
  return Object.fromEntries(row.components.map((one) => [upper(one.name), irTypeFromAbap(one.abapType)]));
}

function outputFrom(method, types) {
  const outputs = method.parameters.filter((one) => one.direction !== "IN");
  if (outputs.length !== 1 || !["OUT", "RETURNING"].includes(outputs[0]?.direction)) {
    throw new UnsupportedSqlScript("initial portable procedures require exactly one OUT or RETURNING output parameter");
  }
  const parameter = outputs[0];
  const schema = structuredTable(parameter.abapType, types);
  if (schema !== undefined) return {name: upper(parameter.name), kind: "relation", schema};
  if (parameter.direction === "RETURNING") {
    const type = irTypeFromAbap(parameter.abapType);
    if (type.abap !== "I") {
      throw new UnsupportedSqlScript("initial scalar RETURNING support is limited to ABAP INTEGER exactly");
    }
    return {name: upper(parameter.name), kind: "scalar", type};
  }
  throw new UnsupportedSqlScript(`output ${parameter.name} is not a resolved structured table type`);
}

/** Compile one extracted AMDP method without changing its source body. */
export function compileProcedure(method, types) {
  const tree = parse(new Body(), lex(method.body));
  const output = outputFrom(method, types);
  const inputParameters = method.parameters.filter((one) => one.direction === "IN");
  const relationCandidates = inputParameters
    .map((one) => ({one, schema: structuredTable(one.abapType, types)}))
    .filter(({schema}) => schema !== undefined);
  if (relationCandidates.some(({one}) => one.optional === true)) {
    throw new UnsupportedSqlScript("initial OPTIONAL support is limited to ABAP INTEGER or STRING scalars");
  }
  const relationParameters = relationCandidates.map(({one, schema}) => ({name: upper(one.name), schema}));
  const relationNames = new Set(relationParameters.map((one) => one.name));
  const relationSchemas = Object.fromEntries(relationParameters.map((one) => [one.name, one.schema]));
  const parameters = inputParameters
    .filter((one) => !relationNames.has(upper(one.name)))
    .map((one) => one.optional === true
      ? {name: upper(one.name), type: irTypeFromAbap(one.abapType), optional: true}
      : {name: upper(one.name), type: irTypeFromAbap(one.abapType)});
  if (parameters.some((one) => !["I", "STRING"].includes(one.type.abap))) {
    throw new UnsupportedSqlScript("initial portable procedure inputs support only INTEGER or STRING scalars");
  }
  const scalarTypes = Object.fromEntries(parameters.map((one) => [one.name, one.type]));
  const arrayValues = Object.create(null);
  const cursorNames = new Set();
  if (output.kind === "scalar") scalarTypes[output.name] = output.type;
  const snapshotEnvironment = () => ({
    relations: structuredClone(relationSchemas),
    scalars: structuredClone(scalarTypes),
  });
  const restoreObject = (target, source) => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, structuredClone(source));
  };
  const restoreEnvironment = (snapshot) => {
    restoreObject(relationSchemas, snapshot.relations);
    restoreObject(scalarTypes, snapshot.scalars);
  };
  const mergeEnvironment = (paths) => {
    const common = (key) => {
      const first = paths[0][key];
      return Object.fromEntries(Object.entries(first).filter(([name, value]) =>
        paths.every((path) => JSON.stringify(path[key][name]) === JSON.stringify(value))));
    };
    restoreObject(relationSchemas, common("relations"));
    restoreObject(scalarTypes, common("scalars"));
  };
  const bind = (node, fragment) => toIr(node, {
    fragment, scalarTypes, relationSchemas, deferTableVariables: true, strictColumns: true,
    signature: method, arrayValues,
  });

  const compileStatements = (container, allowArrayDeclarations = false) => {
    const result = [];
    const directStatements = new Set(["Declare", "Assignment", "While", "If", "Block", "ProcedureCall", "Return", "SetOperation"]);
    for (const wrapper of container.children ?? []) {
      const node = wrapper.node === "Statement"
        ? (wrapper.children ?? []).find((one) => one.node !== "word")
        : (directStatements.has(wrapper.node) ? wrapper : undefined);
      if (node === undefined) continue;
      if (node.node === "Declare") {
        if ((node.children ?? []).some((one) => one.node === "word" && upper(one.value) === "CURSOR")) {
          if (!allowArrayDeclarations) {
            throw new UnsupportedSqlScript("initial CURSOR declarations must be top-level and unconditional", node);
          }
          const name = nameOf(child(node, "Name"));
          if (scalarTypes[name] !== undefined || relationSchemas[name] !== undefined || cursorNames.has(name)) {
            throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
          }
          const occurrences = terminalLeaves(tree).filter((one) =>
            one.node === "identifier" && upper(one.value) === name).length;
          if (occurrences !== 1) {
            throw new UnsupportedSqlScript("initial CURSOR support is limited to a declared but unused cursor", node);
          }
          const query = child(node, "SetOperation");
          if (query === undefined) throw new UnsupportedSqlScript("CURSOR declaration requires a query", node);
          const selects = children(query, "Select");
          const select = selects.length === 1 ? selects[0] : undefined;
          const items = select === undefined ? [] : children(select, "SelectItem");
          const sources = select === undefined ? [] : children(select, "Source");
          const sourceLeaves = sources.length === 1 ? terminalLeaves(sources[0]) : [];
          const directColumns = items.length > 0 && items.every((item) =>
            exactWrapped(child(item, "Expr"), "ColumnRef") !== undefined
            && (item.children ?? []).every((one) => ["Expr", "word"].includes(one.node)));
          const directSource = sourceLeaves.length === 1 && sourceLeaves[0].node === "host"
            && relationNames.has(upper(String(sourceLeaves[0].value).slice(1)));
          const plainSelect = select !== undefined && (select.children ?? []).every((one) =>
            ["word", "SelectItem", "Source"].includes(one.node));
          if (!directColumns || !directSource || !plainSelect) {
            throw new UnsupportedSqlScript(
              "initial unused CURSOR query requires a direct column projection from one table input", node);
          }
          // Binding is still required even though the unopened resource is
          // erased: every projected column must exist and retain its type.
          bind(query, "relation");
          cursorNames.add(name);
          continue;
        }
        if ((node.children ?? []).some((one) => one.node === "word" && upper(one.value) === "ARRAY")) {
          if (!allowArrayDeclarations) {
            throw new UnsupportedSqlScript("initial ARRAY declarations must be top-level and unconditional", node);
          }
          const name = nameOf(child(node, "Name"));
          if (cursorNames.has(name)) throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
          if (Object.keys(arrayValues).length > 0) {
            throw new UnsupportedSqlScript("initial portable subset supports one ARRAY declaration exactly", node);
          }
          if (arrayValues[name] !== undefined) throw new UnsupportedSqlScript(`duplicate ARRAY declaration ${name}`, node);
          const typeNode = child(node, "TypeName");
          const typeLeaves = terminalLeaves(typeNode);
          const typeName = nameOf(typeNode);
          if (typeLeaves.length !== 1 || typeLeaves[0].node !== "identifier"
              || !["INT", "INTEGER"].includes(typeName)) {
            throw new UnsupportedSqlScript("initial ARRAY support is limited to INTEGER elements exactly", node);
          }
          const constructor = exactWrapped(child(node, "Expr"), "FunctionCall");
          if (constructor === undefined || nameOf(constructor) !== "ARRAY") {
            throw new UnsupportedSqlScript("ARRAY declaration requires an ARRAY(...) constructor", node);
          }
          if ((constructor.children ?? []).some((one) => !["identifier", "word", "Expr"].includes(one.node))
              || children(constructor, "identifier").length !== 1) {
            throw new UnsupportedSqlScript("ARRAY constructor decorations are outside the fixed portable subset", constructor);
          }
          const values = children(constructor, "Expr").map((one) =>
            isBareNull(one) ? lit(null, T.int) : bind(one, "expression"));
          if (values.length === 0) throw new UnsupportedSqlScript("empty ARRAY constructor is not supported yet", node);
          if (values.some((one) => one.node !== "lit" || JSON.stringify(one.type) !== JSON.stringify(T.int))) {
            throw new UnsupportedSqlScript("initial ARRAY constructor values must be INTEGER literals or NULL exactly", node);
          }
          if (values.some((one) => one.value != null
              && (!Number.isInteger(one.value) || one.value < -2147483648 || one.value > 2147483647))) {
            throw new UnsupportedSqlScript("ARRAY constructor literal is outside SQLScript INTEGER", node);
          }
          arrayValues[name] = values;
          continue;
        }
        if (child(node, "ColumnDef") !== undefined || (node.children ?? []).some((one) =>
          one.node === "word" && upper(one.value) === "TABLE")) {
          throw new UnsupportedSqlScript("only scalar DECLARE belongs to the initial portable subset", node);
        }
        const name = nameOf(child(node, "Name"));
        if (cursorNames.has(name)) throw new UnsupportedSqlScript(`duplicate declaration ${name}`, node);
        const type = bind(child(node, "TypeName"), "type");
        if (type.abap !== "I" || !["INT", "INTEGER"].includes(nameOf(child(node, "TypeName")))) {
          throw new UnsupportedSqlScript("initial portable DECLARE supports only INTEGER exactly", node);
        }
        scalarTypes[name] = type;
        const initialNode = child(node, "Expr");
        result.push(declareScalar(name, type,
          initialNode === undefined ? undefined : bind(initialNode, "expression"), node));
      } else if (node.node === "Assignment") {
        const name = nameOf(child(node, "Name"));
        const unnest = child(node, "UnnestCall");
        if (unnest !== undefined) {
          const host = (unnest.children ?? []).find((one) => one.node === "host");
          const arrayName = upper(String(host?.value ?? "").slice(1));
          const values = arrayValues[arrayName];
          if (!Array.isArray(values)) {
            throw new UnsupportedSqlScript(`UNNEST refers to unknown array :${arrayName.toLowerCase()}`, unnest);
          }
          const names = children(unnest, "Name").map(nameOf);
          if (names.length !== 2) {
            throw new UnsupportedSqlScript("UNNEST WITH ORDINALITY requires value and position column names", unnest);
          }
          if (names[0] === names[1]) {
            throw new UnsupportedSqlScript("UNNEST WITH ORDINALITY column names must be distinct", unnest);
          }
          const rows = values.map((value, index) => project(scan("DUMMY"), [
            {as: names[0], expr: value}, {as: names[1], expr: lit(index + 1, T.int)},
          ]));
          const rel = rows.length === 1 ? rows[0] : union(rows, true);
          relationSchemas[name] = {[names[0]]: T.int, [names[1]]: T.int};
          result.push(assignRelation(name, rel, node));
          continue;
        }
        const set = child(node, "SetOperation");
        if (set !== undefined) {
          const rel = bind(set, "relation");
          try { relationSchemas[name] = schemaOf(rel); }
          catch (error) { throw new UnsupportedSqlScript(`cannot prove schema assigned to ${name}: ${error.message}`, node); }
          result.push(assignRelation(name, rel, node));
        }
        else {
          if (scalarTypes[name] === undefined) {
            throw new UnsupportedSqlScript(`assignment to undeclared scalar ${name}`, node);
          }
          result.push(assignScalar(name, bind(child(node, "Expr"), "expression"), node));
        }
      } else if (node.node === "ProcedureCall") {
        if (output.kind !== "relation") {
          throw new UnsupportedSqlScript("initial nested CALL requires a table output", node);
        }
        const procedureNode = child(node, "ColumnRef");
        const procedureLeaves = terminalLeaves(procedureNode);
        const hosts = children(node, "host");
        const expressions = children(node, "Expr");
        if (procedureLeaves.length !== 1 || !["quoted", "identifier"].includes(procedureLeaves[0]?.node)
            || hosts.length !== 1 || expressions.length !== 1) {
          throw new UnsupportedSqlScript(
            "initial nested CALL requires one unqualified procedure, one table input and one table output", node);
        }
        const input = upper(String(hosts[0].value).slice(1));
        const outputExpr = exactWrapped(expressions[0], "ColumnRef");
        const outputLeaves = terminalLeaves(outputExpr);
        const calledOutput = outputLeaves.length === 1 ? upper(outputLeaves[0].value) : "";
        if (relationSchemas[input] === undefined) {
          throw new UnsupportedSqlScript(`nested CALL input :${input.toLowerCase()} is not a typed relation`, node);
        }
        if (calledOutput !== output.name) {
          throw new UnsupportedSqlScript(
            "initial nested CALL must write directly to the enclosing procedure output", node);
        }
        relationSchemas[calledOutput] = structuredClone(output.schema);
        result.push(callProcedure(procedureLeaves[0].value, input, calledOutput, node));
      } else if (node.node === "While") {
        result.push(whileLoop(bind(child(node, "Condition"), "condition"), compileStatements(node), node));
      } else if (node.node === "Block") {
        const mode = (node.children ?? []).filter((one) => one.node === "word")
          .map((one) => upper(one.value)).filter((one) => !["BEGIN", "END", ";"].includes(one));
        const statements = children(node, "Statement");
        const statement = statements.length === 1
          ? (statements[0].children ?? []).find((one) => one.node !== "word")
          : undefined;
        const assignsOutput = statement?.node === "Assignment"
          && nameOf(child(statement, "Name")) === output.name;
        if (JSON.stringify(mode) !== JSON.stringify(["SEQUENTIAL", "EXECUTION"]) || !assignsOutput) {
          throw new UnsupportedSqlScript(
            "initial block support requires BEGIN SEQUENTIAL EXECUTION with exactly one assignment to the procedure output", node);
        }
        result.push(...compileStatements({children: statements}));
      } else if (node.node === "If") {
        const before = snapshotEnvironment();
        const branches = [];
        const paths = [];
        let current;
        let otherwise = [];
        const finish = () => {
          if (current === undefined) return;
          // Each arm begins from the same pre-IF environment. Compiling an
          // earlier arm must not leak its table/scalar types into a later
          // arm. Only identical facts on every reachable path survive.
          restoreEnvironment(before);
          const body = compileStatements({children: current.statements});
          paths.push(snapshotEnvironment());
          if (current.condition === undefined) otherwise = body;
          else branches.push({condition: current.condition, body});
        };
        for (const part of node.children ?? []) {
          const word = part.node === "word" ? upper(part.value) : undefined;
          if (word === "IF" || word === "ELSEIF") {
            finish();
            current = {condition: null, statements: []};
          } else if (word === "ELSE") {
            finish();
            current = {condition: undefined, statements: []};
          } else if (word === "END") {
            finish();
            current = undefined;
            break;
          } else if (part.node === "Condition" && current?.condition === null) {
            restoreEnvironment(before);
            current.condition = bind(part, "condition");
          } else if (part.node === "Statement" && current !== undefined) {
            current.statements.push(part);
          }
        }
        if (branches.length === 0 || branches.some((branch) => branch.condition == null)) {
          throw new UnsupportedSqlScript("IF has no complete conditional branch", node);
        }
        if (otherwise.length === 0) paths.push(before);
        mergeEnvironment(paths);
        result.push(ifElse(branches, otherwise, node));
      } else {
        throw new UnsupportedSqlScript(`${node.node} is outside the initial portable procedural subset`, node);
      }
    }
    return result;
  };

  try {
    const body = compileStatements(tree, true);
    const containsRelationStatement = (statements) => statements.some((statement) =>
      statement.stmt === "assign-relation"
        || statement.stmt === "call-procedure"
        || (statement.stmt === "while" && containsRelationStatement(statement.body ?? []))
        || (statement.stmt === "if" && (statement.branches ?? []).some((branch) =>
          containsRelationStatement(branch.body ?? []))
          || (statement.stmt === "if" && containsRelationStatement(statement.otherwise ?? []))));
    if (output.kind === "scalar" && (relationParameters.length > 0 || containsRelationStatement(body))) {
      throw new UnsupportedSqlScript("scalar-only portable functions cannot contain relational inputs or statements");
    }
    return procedure({parameters, relationParameters, body, output: output.name,
      outputSchema: output.kind === "relation" ? output.schema : undefined,
      outputType: output.kind === "scalar" ? output.type : undefined});
  } catch (error) {
    if (error instanceof UnsupportedSqlScript) throw error;
    if (error instanceof BindError) throw new UnsupportedSqlScript(error.message, error);
    throw error;
  }
}
