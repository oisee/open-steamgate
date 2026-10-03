// Kernel compatibility diagnostics for runners and unsaved editor buffers.
import {createRequire} from "node:module";
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";

export const KERNEL_FORMS = Object.freeze([
  ...["BIT-AND", "BIT-OR", "BIT-XOR", "BIT-NOT"].map((operator) => Object.freeze({
    operator, form: `${operator} on non-byte operands`,
    anchor: `kernel-${operator.toLowerCase()}-operand-not-x`, title: `${operator} on non-byte operands`,
  })),
  Object.freeze({form: "offset/length write on xstring", anchor: "kernel-xstring-offset-write", title: "Offset/length write on xstring"}),
]);

export const kernelWarningForms = KERNEL_FORMS;

export function kernelWarnings(input, registry) {
  if (process.env.OSD_KERNEL_SCANNER_FAIL === "1") throw new Error("forced scanner failure");
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
  // Inventory callers can reuse their focused parse rather than hold two ASTs.
  const reg = registry ?? new core.Registry(new core.Config(JSON.stringify({
    global: {files: "/**/*.*"}, syntax: {version: core.Version.OpenABAP}, rules: {},
  })));
  if (!registry) {
    const buffers = Array.isArray(input) ? input : typeof input === "object" ? [input]
      : readdirSync(input).filter((f) => /\.(abap|xml)$/.test(f)).sort()
        .map((file) => ({file, source: readFileSync(join(input, file), "utf8")}));
    for (const {file, source} of buffers) reg.addFile(new core.MemoryFile(file, source));
    reg.parse();
  }
  const warnings = [], seen = new Set();
  const warn = (file, node, form) => {
    const line = node.getFirstToken().getRow();
    const key = `${file}:${node.getFirstToken().getCol()}:${line}:${form}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entry = KERNEL_FORMS.find((f) => f.form === form || (f.operator && form.startsWith(f.operator + " on ")));
    warnings.push({file, line, kind: "kernel-reject", form,
      message: `${file}:${line}: ${form}: this form is rejected on a SAP system`,
      supportAnchor: `docs/osg-support.md#${entry.anchor}`});
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
            && kernelWarningForms.slice(0, 3).some((f) => f.operator === c.concatTokens().toUpperCase()));
          const prefix = children.slice(0, 3);
          const unary = prefix.every((c) => c instanceof Nodes.TokenNode)
            && prefix.map((c) => c.getFirstToken().getStr()).join("").toUpperCase() === kernelWarningForms[3].operator;
          const syntax = operator || unary ? syntaxFor(node) : undefined;
          if (syntax) {
            const split = operator ? children.indexOf(operator) : children.length;
            const check = (part, op, location) => {
              const operand = new Nodes.ExpressionNode(new E.Source()).setChildren(part);
              const type = Source.runSyntax(operand, syntax);
              if (knownType(type) && !byteType(type))
                warn(filename, location, `${op} on ${type.toABAP().replace(/\s+/g, " ")}`);
            };
            if (unary) check(children.slice(3, split), kernelWarningForms[3].operator, node);
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
              warn(filename, node, kernelWarningForms[4].form);
          }
        }
        for (const child of children) if (!(child instanceof Nodes.TokenNode)) visit(child);
      };
      visit(tree);
    }
  }
  return warnings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

