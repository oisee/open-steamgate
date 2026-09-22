// Bind the imperative SQLScript syntax tree to the portable procedure IR.
//
// Statement ownership lives here; expressions and relations deliberately go
// through the established relational binder in to-ir.mjs. That keeps one
// implementation of SQLScript typing and one list of explicit refusals.
import {T, schemaOf} from "./sqlscript-ir.mjs";
import {toIr, BindError} from "./sqlscript/to-ir.mjs";
import {lex} from "./sqlscript/lexer.mjs";
import {parse} from "./sqlscript/combi.mjs";
import {Body} from "./sqlscript/expressions/index.mjs";
import {procedure, declareScalar, assignScalar, assignRelation, whileLoop,
  ifElse, UnsupportedSqlScript} from "./sqlscript-procedure-ir.mjs";

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
    throw new UnsupportedSqlScript("initial portable procedures require exactly one OUT or RETURNING table parameter");
  }
  const parameter = outputs[0];
  const schema = structuredTable(parameter.abapType, types);
  if (schema === undefined) {
    throw new UnsupportedSqlScript(`output ${parameter.name} is not a resolved structured table type`);
  }
  return {name: upper(parameter.name), schema};
}

/** Compile one extracted AMDP method without changing its source body. */
export function compileProcedure(method, types) {
  const tree = parse(new Body(), lex(method.body));
  const output = outputFrom(method, types);
  const inputParameters = method.parameters.filter((one) => one.direction === "IN");
  const relationParameters = inputParameters
    .map((one) => ({one, schema: structuredTable(one.abapType, types)}))
    .filter(({schema}) => schema !== undefined)
    .map(({one, schema}) => ({name: upper(one.name), schema}));
  const relationNames = new Set(relationParameters.map((one) => one.name));
  const relationSchemas = Object.fromEntries(relationParameters.map((one) => [one.name, one.schema]));
  const parameters = inputParameters
    .filter((one) => !relationNames.has(upper(one.name)))
    .map((one) => ({name: upper(one.name), type: irTypeFromAbap(one.abapType)}));
  if (parameters.some((one) => one.type.abap !== "I")) {
    throw new UnsupportedSqlScript("initial portable procedure inputs support only INTEGER scalars");
  }
  const scalarTypes = Object.fromEntries(parameters.map((one) => [one.name, one.type]));
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
    signature: method,
  });

  const compileStatements = (container) => {
    const result = [];
    const directStatements = new Set(["Declare", "Assignment", "While", "If", "Block", "Return", "SetOperation"]);
    for (const wrapper of container.children ?? []) {
      const node = wrapper.node === "Statement"
        ? (wrapper.children ?? []).find((one) => one.node !== "word")
        : (directStatements.has(wrapper.node) ? wrapper : undefined);
      if (node === undefined) continue;
      if (node.node === "Declare") {
        if (child(node, "ColumnDef") !== undefined || (node.children ?? []).some((one) =>
          one.node === "word" && ["TABLE", "CURSOR"].includes(upper(one.value)))) {
          throw new UnsupportedSqlScript("only scalar DECLARE belongs to the initial portable subset", node);
        }
        const name = nameOf(child(node, "Name"));
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
        const set = child(node, "SetOperation");
        if (set !== undefined) {
          const rel = bind(set, "relation");
          try { relationSchemas[name] = schemaOf(rel); }
          catch (error) { throw new UnsupportedSqlScript(`cannot prove schema assigned to ${name}: ${error.message}`, node); }
          result.push(assignRelation(name, rel, node));
        }
        else result.push(assignScalar(name, bind(child(node, "Expr"), "expression"), node));
      } else if (node.node === "While") {
        result.push(whileLoop(bind(child(node, "Condition"), "condition"), compileStatements(node), node));
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
    return procedure({parameters, relationParameters, body: compileStatements(tree),
      output: output.name, outputSchema: output.schema});
  } catch (error) {
    if (error instanceof UnsupportedSqlScript) throw error;
    if (error instanceof BindError) throw new UnsupportedSqlScript(error.message, error);
    throw error;
  }
}
