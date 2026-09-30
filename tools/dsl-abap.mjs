#!/usr/bin/env node
// L1 declarations from abaplint's registry, SyntaxLogic and expression tree.
import {readFileSync, readdirSync, statSync} from "node:fs";
import {basename, join} from "node:path";
import {pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {DEFAULT_DDIC, registryFor, KEY_PROVIDERS, TYPE_PROVIDERS} from "./dsl-ddic.mjs";
export {DDIC_PROVIDER, KEY_PROVIDERS, TYPE_PROVIDERS} from "./dsl-ddic.mjs";

const abaplint = createRequire(import.meta.url)("@abaplint/core");
const {Expressions, Statements} = abaplint;

// The provider result includes both the full key and each column's resolved
// type. R1 uses this same L1 boundary for its key/type obligations.
export function abapKeyModel(registry, table) {
  for (const provider of KEY_PROVIDERS) {
    const result = provider(registry, table);
    if (result) return result;
  }
  return undefined;
}

function filesIn(paths) {
  return paths.flatMap((path) => {
    if (statSync(path).isFile()) return [path];
    return readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => entry.name === "node_modules" || entry.name === ".git" ? [] : filesIn([join(path, entry.name)]));
  }).filter((path) => /\.(clas|intf)\.abap$/i.test(path));
}

const pos = (file, start) => ({file, line: start.getRow()});
const nameOf = (node) => node?.concatTokens().toLowerCase();
const at = (file, item, id, extra = {}) => ({"@id": id, ...pos(file, item.getStart()), ...extra});

function syntaxType(registry, type, name) {
  for (const provider of TYPE_PROVIDERS) {
    const result = provider.type?.(registry, type, name);
    if (result) return result;
  }
  return {resolved: false, abap_type: name ?? "unknown"};
}

function literalType(registry, type, name) {
  for (const provider of TYPE_PROVIDERS) {
    const result = provider.literalType?.(registry, type, name);
    if (result) return result;
  }
  return {resolved: false, reason: `${name ?? "type"} has no literal type provider`};
}

function literalText(expression) {
  const constant = expression?.findFirstExpression(Expressions.Constant);
  if (!constant || constant.findFirstExpression(Expressions.ConcatenatedConstant)) return undefined;
  if (!constant.findFirstExpression(Expressions.ConstantString)
    && !constant.findFirstExpression(Expressions.Integer)) return undefined;
  const raw = constant.concatTokens();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith("`") && raw.endsWith("`"))) {
    const quote = raw[0];
    return raw.slice(1, -1).replaceAll(quote + quote, quote);
  }
  return raw;
}

function valueFields(registry, type, expression, prefix, name) {
  if (!expression) return {};
  const value = literalText(expression);
  if (value === undefined) return {[`${prefix}_expr`]: expression.findFirstExpression(Expressions.SimpleFieldChain)?.concatTokens() ?? expression.concatTokens()};
  const resolved = literalType(registry, type, name);
  return resolved.resolved === false
    ? {[prefix]: value, literal_type: resolved}
    : {[prefix]: value, [`${prefix}@type`]: resolved};
}

function typeName(node) {
  return node?.findAllExpressions(Expressions.TypeName)?.[0]?.concatTokens().toLowerCase();
}

function declaration(registry, file, item, id, extra = {}, syntaxName) {
  return at(file, item, id, {...extra, "@type": syntaxType(registry, item.getType(), syntaxName)});
}

function methodNode(registry, file, name, method, statement) {
  const methodId = `${name}/method/${method.getName().toLowerCase()}`;
  const parsed = statement?.findAllExpressions(Expressions.MethodParam) ?? [];
  const params = method.getParameters().getAll().map((param) => {
    const paramName = param.getName().toLowerCase();
    const expression = parsed.find((node) => nameOf(node.findDirectExpression(Expressions.MethodParamName)) === paramName);
    const defaultExpression = method.getParameters().getParameterDefault(param.getName());
    return declaration(registry, file, param, `${methodId}/param/${paramName}`, {
      name: paramName, kind: param.getMeta().find((meta) => ["importing", "exporting", "changing", "returning"].includes(meta)),
      ...valueFields(registry, param.getType(), defaultExpression, "default", typeName(expression)),
    }, typeName(expression));
  }).sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return at(file, method, methodId, {name: method.getName().toLowerCase(), visibility: abaplint.Visibility[method.getVisibility()].toLowerCase(),
    static: method.isStatic(), parameters: params});
}

function objectModel(registry, object, sourcePath) {
  // SyntaxLogic populates the semantic definitions used below. It also
  // resolves data elements, local types and method parameter directions.
  new abaplint.SyntaxLogic(registry, object).run();
  const definition = object.getDefinition();
  if (!definition) throw new Error(`${sourcePath}: abaplint cannot resolve the declaration`);
  const file = object.getMainABAPFile();
  const statements = file.getStatements();
  const isClass = object.getType() === "CLAS";
  const name = object.getName().toLowerCase();
  const id = `${isClass ? "class" : "interface"}/${name}`;
  const heading = statements.find((st) => st.get() instanceof (isClass ? Statements.ClassDefinition : Statements.Interface));
  const methodStatements = statements.filter((st) => st.get() instanceof Statements.MethodDef);
  const methods = [...definition.getMethodDefinitions().getAll()].map((method) => {
    const statement = methodStatements.find((st) => nameOf(st.findDirectExpression(Expressions.MethodName)) === method.getName().toLowerCase());
    return methodNode(registry, sourcePath, id, method, statement);
  });
  const attributes = [...definition.getAttributes().getAll(), ...definition.getAttributes().getConstants()].map((attribute) => {
    const statement = statements.find((st) => st.get() instanceof Statements.Constant
      && nameOf(st.findFirstExpression(Expressions.DefinitionName)) === attribute.getName().toLowerCase());
    const isConstant = attribute.getMeta().includes("read_only") && attribute.getMeta().includes("static") && !!statement;
    const expression = statement?.findFirstExpression(Expressions.Value);
    return declaration(registry, sourcePath, attribute, `${id}/attribute/${attribute.getName().toLowerCase()}`,
      {name: attribute.getName().toLowerCase(), ...(isConstant ? {constant: true,
        declared_type: typeName(statement),
        ...valueFields(registry, attribute.getType(), expression, "value", typeName(statement))} : {})}, undefined);
  });
  const types = [...definition.getTypeDefinitions().getAll()].map((entry) => {
    const type = entry.type;
    return declaration(registry, sourcePath, type, `${id}/type/${type.getName().toLowerCase()}`,
      {name: type.getName().toLowerCase()}, undefined);
  });
  const position = (st) => pos(sourcePath, st.getStart());
  const superclass = isClass && definition.getSuperClass() ? {
    "@id": `${id}/superclass/${definition.getSuperClass().toLowerCase()}`,
    name: definition.getSuperClass().toLowerCase(), ...position(heading),
  } : null;
  const implemented = isClass ? definition.getImplementing() : definition.getImplementing?.() ?? [];
  const interfaces = implemented.map((entry) => ({
    "@id": `${id}/interface/${entry.name.toLowerCase()}`, name: entry.name.toLowerCase(),
    ...position(statements.find((st) => st.get() instanceof Statements.InterfaceDef
      && nameOf(st.findDirectExpression(Expressions.InterfaceName)) === entry.name.toLowerCase()) ?? heading),
  }));
  return {"@id": id, name, ...position(heading), superclass, interfaces, attributes, types, methods};
}

export function abapModel(files, {ddic = DEFAULT_DDIC} = {}) {
  const paths = filesIn(files);
  const names = new Set();
  const sources = paths.map((path) => {
    const name = basename(path);
    if (names.has(name.toLowerCase())) throw new Error(`duplicate ABAP file name: ${name}`);
    names.add(name.toLowerCase());
    return {name, source: readFileSync(path, "utf8")};
  });
  const registry = registryFor(ddic, sources);
  const pathsByName = new Map(paths.map((path) => [basename(path), path]));
  const classes = [], interfaces = [];
  for (const object of registry.getObjects()) {
    if (!["CLAS", "INTF"].includes(object.getType())) continue;
    const path = pathsByName.get(object.getMainABAPFile()?.getFilename());
    if (!path) continue;
    (object.getType() === "CLAS" ? classes : interfaces).push(objectModel(registry, object, path));
  }
  return {classes, interfaces};
}

function displayType(type) {
  if (!type.resolved) return `${type.abap_type} (unresolved)`;
  const base = type.data_element ?? type.abap_type ?? type.built_in;
  const size = type.length === undefined ? "" : `(${type.length}${type.decimals === undefined ? "" : `,${type.decimals}`})`;
  return `${base}${size}`;
}

export function methodTableModel(model, className) {
  const cls = model.classes.find((entry) => entry.name === className.toLowerCase());
  if (!cls) throw new Error(`class ${className} not found`);
  return {classes: [{...cls, public_methods: cls.methods.filter((method) => method.visibility === "public")
    .map((method) => ({...method, signature: method.parameters.map((param) =>
      `${param.kind} ${param.name}: ${displayType(param["@type"])}`).join(", ")}))}]};
}

export function constantsModel(model, className) {
  const cls = model.classes.find((entry) => entry.name === className.toLowerCase());
  if (!cls) throw new Error(`class ${className} not found`);
  const names = {CHAR: "c", NUMC: "n", INT4: "i", INT8: "int8", DEC: "p", STRG: "string",
    RAW: "x", DATS: "d", TIMS: "t"};
  return {classes: [{...cls, constants: cls.attributes.filter((attribute) => attribute.constant && attribute["value@type"])
    .map((attribute) => {
      const type = attribute["@type"];
      const basic = attribute.declared_type ?? type.data_element ?? type.abap_type ?? names[attribute["value@type"].built_in];
      const isDDIC = !["c", "n", "i", "int8", "p", "string", "x", "d", "t"].includes(basic);
      const length = !isDDIC && ["CHAR", "NUMC", "DEC", "RAW"].includes(type.built_in)
        ? ` LENGTH ${type.length}` : "";
      const decimals = type.built_in === "DEC" && !isDDIC ? ` DECIMALS ${type.decimals}` : "";
      return {...attribute, declaration_type: `${basic}${length}${decimals}`};
    })}]};
}

async function renderRecipe(data, template) {
  await import("../test/start.mjs");
  await import("../output/zcl_osd_tpl.clas.mjs");
  await import("../output/zcl_ajson.clas.mjs");
  const abap = globalThis.abap;
  const box = (value) => new abap.types.String().set(value);
  const json = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(data))});
  let result;
  try {
    result = await abap.Classes.ZCL_OSD_TPL.render({
      iv_template: box(readFileSync(template, "utf8")), ii_data: json,
    });
  } catch (error) {
    if (error.text?.get) throw new Error(error.text.get(), {cause: error});
    throw error;
  }
  const text = (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get();
  const trace = result.get().trace.array().map((entry) => ({
    line: entry.get().line.get(), template_line: entry.get().template_line.get(), path: entry.get().path.get(),
  }));
  const nodeAt = (path) => {
    const parts = path.split("/").slice(1);
    let current = data, node;
    for (const part of parts) {
      current = Array.isArray(current) ? current[Number(part) - 1] : current?.[part];
      if (current?.["@id"]) node = current["@id"];
    }
    return node;
  };
  return {text, trace: trace.map((entry) => ({...entry, node: nodeAt(entry.path)}))};
}

export async function renderMethodTable(model, className) {
  return renderRecipe(methodTableModel(model, className), "recipes/abap-methods/template.tpl");
}

export async function renderConstants(model, className) {
  return renderRecipe(constantsModel(model, className), "recipes/abap-constants/template.tpl");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (!["model", "render-constants"].includes(command)) {
    console.error("Usage: node tools/dsl-abap.mjs <model|render-constants> <folder>... [--ddic <folder>]... [--class <name>]");
    process.exitCode = 2;
  } else {
    try {
      const folders = [], ddic = [];
      let className;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--ddic") ddic.push(args[++i]);
        else if (args[i] === "--class") className = args[++i]?.toLowerCase();
        else folders.push(args[i]);
      }
      if (!folders.length) throw new Error("at least one ABAP folder is required");
      if (command === "render-constants" && !className) throw new Error("render-constants needs --class");
      const model = abapModel(folders, {ddic: ddic.length ? ddic : DEFAULT_DDIC});
      if (className) {
        model.classes = model.classes.filter((cls) => cls.name === className);
        if (!model.classes.length) throw new Error(`class ${className} not found`);
        model.interfaces = [];
      }
      if (command === "model") console.log(JSON.stringify(model, null, 2));
      else {
        // Runtime bootstrap has diagnostics; keep stdout a single JSON result.
        const originalLog = console.log;
        let rendered;
        try {
          console.log = (...items) => console.error(...items);
          rendered = await renderConstants(model, className);
        } finally {
          console.log = originalLog;
        }
        console.log(JSON.stringify(rendered, null, 2));
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
