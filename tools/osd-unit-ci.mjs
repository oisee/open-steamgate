// The common folder CI contract for the Go and JavaScript ABAP Unit hosts.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync} from "node:fs";
import {basename, join, resolve} from "node:path";

const ownerOf = (file) => basename(file).split(".")[0].replaceAll("#", "/").toUpperCase();

export function kernelWarnings(input) {
  // Resolve lazily: ordinary transpilation and a compiled host need no checkout-only scanner.
  // Use the transpiler's copy throughout: its AST nodes use instanceof checks.
  const require = createRequire(import.meta.url);
  const coreRequire = createRequire(require.resolve("@abaplint/transpiler/package.json"));
  const core = coreRequire("@abaplint/core");
  const syntaxPath = "@abaplint/core/build/src/abap/5_syntax/";
  const {CurrentScope} = coreRequire(syntaxPath + "_current_scope");
  const {Source} = coreRequire(syntaxPath + "expressions/source");
  const {Target} = coreRequire(syntaxPath + "expressions/target");
  const {Rearranger} = require("@abaplint/transpiler/build/src/rearranger");
  const {Nodes, Expressions: E, BasicTypes: T} = core;
  const expr = (node, kind) => node instanceof Nodes.ExpressionNode && node.get() instanceof kind;
  const byteType = (type) => type instanceof T.HexType || type instanceof T.XStringType
    || type instanceof T.XGenericType || type instanceof T.XSequenceType;
  const knownType = (type) => type && !(type instanceof T.VoidType) && !(type instanceof T.UnknownType);

  // Registries live in child processes in both runners. This focused pass reads
  // only input objects, including synthesized metadata, and never lint rules.
  const reg = new core.Registry(new core.Config(JSON.stringify({
    global: {files: "/**/*.*"}, syntax: {version: core.Version.OpenABAP}, rules: {},
  })));
  for (const file of readdirSync(input).filter((f) => /\.(abap|xml)$/.test(f)).sort())
    reg.addFile(new core.MemoryFile(file, readFileSync(join(input, file), "utf8")));
  reg.parse();
  const warnings = [], seen = new Set();
  const warn = (file, node, form) => {
    const line = node.getFirstToken().getRow();
    const key = `${file}:${node.getFirstToken().getCol()}:${line}:${form}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push({file, line, kind: "kernel-reject", form,
      message: `${file}:${line}: ${form}: this form is rejected on a SAP system`});
  };
  for (const obj of reg.getObjects()) {
    if (!obj.getABAPFiles) continue;
    const {spaghetti} = new core.SyntaxLogic(reg, obj).run();
    for (const file of obj.getABAPFiles()) {
      const filename = file.getFilename();
      const tree = new Rearranger().run(obj.getType(), file.getStructure());
      if (!tree) continue;
      // Scope lookup and expression resolution are needed only for candidate
      // bit expressions and slice targets, not for every expression in a file.
      const syntaxFor = (node) => {
        const current = spaghetti.lookupPosition(node.getFirstToken().getStart(), filename);
        if (!current) return undefined;
        const scope = new CurrentScope(reg, obj);
        scope.current = current;
        return {scope, filename, issues: []};
      };
      const visit = (node) => {
        const children = node.getChildren();
        if (expr(node, E.Source)) {
          const operator = children.find((c) => expr(c, E.ArithOperator)
            && ["BIT-AND", "BIT-OR", "BIT-XOR"].includes(c.concatTokens().toUpperCase()));
          const prefix = children.slice(0, 3);
          const unary = prefix.every((c) => c instanceof Nodes.TokenNode)
            && prefix.map((c) => c.getFirstToken().getStr()).join("").toUpperCase() === "BIT-NOT";
          const syntax = operator || unary ? syntaxFor(node) : undefined;
          if (syntax) {
            const split = operator ? children.indexOf(operator) : children.length;
            const check = (part, op, location) => {
              const operand = new Nodes.ExpressionNode(new E.Source()).setChildren(part);
              const type = Source.runSyntax(operand, syntax);
              if (knownType(type) && !byteType(type))
                warn(filename, location, `${op} on ${type.toABAP().replace(/\s+/g, " ")}`);
            };
            if (unary) check(children.slice(3, split), "BIT-NOT", node);
            if (operator) {
              const op = operator.concatTokens().toUpperCase();
              check(children.slice(unary ? 3 : 0, split), op, operator);
              check(children.slice(split + 1), op, operator);
            }
          }
        } else if (expr(node, E.Target) && children.some((c) => expr(c, E.FieldOffset) || expr(c, E.FieldLength))) {
          const syntax = syntaxFor(node);
          if (syntax) {
            // Resolve the base before slicing: Target.runSyntax deliberately
            // returns VoidType for precisely the xstring write we diagnose.
            const base = new Nodes.ExpressionNode(new E.Target()).setChildren(children.filter((c) =>
              !expr(c, E.FieldOffset) && !expr(c, E.FieldLength)));
            if (Target.runSyntax(base, syntax) instanceof T.XStringType)
              warn(filename, node, "offset/length write on xstring");
          }
        }
        for (const child of children) if (!(child instanceof Nodes.TokenNode)) visit(child);
      };
      visit(tree);
    }
  }
  return warnings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function applyKernelWarnings(result, warnings, strict = false, selected = []) {
  for (const warning of warnings) console.error(warning.message);
  const findings = warnings.filter((w) => w.kind === "kernel-reject");
  const rows = result.rows.map((row) => {
    const alerts = findings.filter((w) => ownerOf(w.file) === row.class).map((w) => w.message);
    return alerts.length ? {...row, alerts: [...(row.alerts ?? []), ...alerts],
      ...(strict && (!selected.length || selected.includes(row.class)) ? {status: "ERROR", message: [row.message, ...alerts].filter(Boolean).join("\n")} : {})} : row;
  });
  if (strict) for (const owner of new Set(findings.map((w) => ownerOf(w.file)))) {
    if ((selected.length && !selected.includes(owner)) || rows.some((r) => r.class === owner)) continue;
    const alerts = findings.filter((w) => ownerOf(w.file) === owner).map((w) => w.message);
    rows.push({class: owner, status: "ERROR", message: alerts.join("\n"), alerts});
  }
  return {...result, rows, warnings};
}

export function metadata(name) {
  const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
  <CLSNAME>${xml(name)}</CLSNAME><LANGU>E</LANGU><DESCRIPT>${xml(name)}</DESCRIPT>
  <EXPOSURE>2</EXPOSURE><STATE>1</STATE><UNICODE>X</UNICODE><FIXPT>X</FIXPT><WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>
 </VSEOCLASS></asx:values></asx:abap>
</abapGit>
`;
}

export function summarize(result) {
  const totals = {success: 0, failure: 0, not_compiled: 0, error: 0, tests: 0};
  const rows = result.rows.map((row) => {
    let status = row.status === "FAILED" ? "FAILURE" : row.status;
    // A process failure is infrastructure, not a failed ABAP assertion.
    if (status === "FAILURE" && /^(runner:|runner died:|seed image:)/.test(row.message ?? "")) status = "ERROR";
    if (!["SUCCESS", "FAILURE", "NOT_COMPILED", "ERROR"].includes(status)) status = "ERROR";
    totals[status.toLowerCase()]++;
    if (row.method) totals.tests++;
    return {...row, status};
  });
  const code = totals.not_compiled || totals.error ? 2 : !totals.tests ? 3 : totals.failure ? 1 : 0;
  return {result: {...result, rows, totals, overrides: result.overrides ?? []}, code};
}

export function stageInput(directory, selected, prefix) {
  const files = readdirSync(directory, {withFileTypes: true}).filter((e) => e.isFile()).map((e) => e.name).sort();
  const names = files.filter((f) => f.endsWith(".clas.testclasses.abap") && files.includes(f.replace(".testclasses.abap", ".abap")))
    .map((f) => f.replace(/\.clas\.testclasses\.abap$/, "").replaceAll("#", "/").toUpperCase());
  for (const name of selected) if (!names.includes(name)) throw new Error(`unknown test owner: ${name}`);
  const chosen = [...new Set(selected.length ? selected : names)];
  if (!chosen.length) return {chosen, result: {classes: 0, compiled: 0, rows: [], timingMs: {}}};
  const local = resolve(import.meta.dirname, "../.local");
  mkdirSync(local, {recursive: true});
  const staging = mkdtempSync(join(local, prefix + "-"));
  const input = join(staging, "input");
  try {
    mkdirSync(input);
    const errors = [];
    // Return validation failures along with the directory so both callers clean it.
    for (const file of files.filter((f) => /\.(abap|xml)$/.test(f))) {
      if (file.endsWith(".abap")) readFileSync(join(directory, file), "utf8").split(/\r\n|\n|\r/).forEach((line, i) => {
        if ([...line].length > 255) errors.push({status: "ERROR", message: `${file}:${i + 1}: line exceeds 255 characters (the kernel refuses it)`});
      });
      copyFileSync(join(directory, file), join(input, file));
    }
    for (const file of files.filter((f) => f.endsWith(".clas.abap"))) {
      const name = file.replace(/\.clas\.abap$/, "");
      if (!existsSync(join(input, `${name}.clas.xml`))) writeFileSync(join(input, `${name}.clas.xml`), metadata(name.replaceAll("#", "/").toUpperCase()));
    }
    return {chosen, staging, input, result: errors.length ? {classes: chosen.length, compiled: 0, rows: errors, timingMs: {}} : undefined};
  } catch (error) {
    rmSync(staging, {recursive: true, force: true});
    throw error;
  }
}

export function printResult(result, json) {
  if (json) console.log(JSON.stringify(result));
  else {
    for (const row of result.rows.filter((r) => r.status !== "SUCCESS"))
      console.log(`${[row.class, row.testclass, row.method].filter(Boolean).join("/") || "run"}: ${row.status} ${String(row.message ?? "").replace(/\s+/g, " ")}`);
    const t = result.totals;
    console.log(`Tests: ${t.tests}, SUCCESS: ${t.success}, FAILURE: ${t.failure}, NOT_COMPILED: ${t.not_compiled}, ERROR: ${t.error}`);
  }
}

export const run = (command, cwd, env = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command[0], command.slice(1), {cwd, env: {...process.env, OSG_HOME: cwd, OSD_ROOT: cwd, ...env}, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"]});
  let stdout = "", stderr = "", interrupted;
  // Only this invocation's process group is ours. Let its children finish before cleanup.
  const stop = (signal) => {
    interrupted = signal;
    if (!child.pid) return;
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const onInt = () => stop("SIGINT"), onTerm = () => stop("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  child.on("error", reject);
  child.on("close", (status, signal) => {
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
    resolveRun({stdout, stderr, status, signal: interrupted ?? signal});
  });
});
