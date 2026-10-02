// Semantic diagnostics for a stored CDS view and its generated consumers.
import {parseDDLS, viewFieldsOf} from "./cds2ddic.mjs";

/**
 * What the generator says about a CDS view, as issues.
 *
 * `parseDDLS` is the only thing here that reads one, and it already refuses
 * by name -- `skip` for a shape it will not generate, `unresolvedAssociations`
 * for an element naming an association the source does not have, `write.why`
 * for a view that asked to be written and cannot be. Those are exactly the
 * sentences a person editing the view needs, and they were being thrown away.
 */
export function ddlsIssues(registry, object) {
  let view;
  try {
    view = parseDDLS(object, registry);
  } catch (error) {
    return [{severity: "E", rule: "cds", message: `the view cannot be read: ${String(error.message ?? error)}`,
      file: object.getFiles?.()[0]?.getFilename?.(), line: 1, column: 1}];
  }
  if (view === undefined) {
    return [{severity: "E", rule: "cds", message: "the view has no parse tree: it is not a CDS view this system can read",
      file: object.getFiles?.()[0]?.getFilename?.(), line: 1, column: 1}];
  }
  const at = {file: object.getFiles?.()[0]?.getFilename?.(), line: 1, column: 1};
  const issues = [];
  // **A table function is not a broken view.** `define table function` has
  // no SELECT by design -- its rows come from an AMDP method -- so
  // `parseDDLS` skips it with "no select", and reporting that as an error
  // tells a person their table function is broken. Measured over the whole
  // tree: 11 of 13 views checked clean and one of the two was this, a false
  // positive of the check rather than a defect of the object.
  //
  // The kinds this generator does not handle are silent; the views it cannot
  // READ are not. Those are different answers and they were getting one word.
  const declares = (object.getFiles?.() ?? []).map((f) => f.getRaw?.() ?? "").join("\n");
  if (/\bdefine\s+table\s+function\b/i.test(declares)) {
    return [];
  }
  // A source that is not in the system at all. Measured: a view selecting
  // from `znot_a_table` parsed without complaint, checked clean, and the
  // BUILD then failed naming a consumer -- `zcl_zosd_status_dpc:43`, "not
  // found" -- and never the view. The generator does not refuse it because
  // it has no opinion about names it cannot resolve; the registry does.
  if (view.source !== undefined && view.source !== ""
      && registry.getObject("TABL", view.source) === undefined
      && registry.getObject("VIEW", view.source) === undefined
      && registry.getObject("DDLS", view.source) === undefined) {
    issues.push({severity: "E", rule: "cds",
      message: `${view.name} selects from ${view.source}, which is not a table or a view of this system`, ...at});
  }
  if (view.skip !== undefined) {
    issues.push({severity: "E", rule: "cds", message: `the generator will not generate this view: ${view.skip}`, ...at});
  }
  for (const name of view.unresolvedAssociations ?? []) {
    issues.push({severity: "E", rule: "cds",
      message: `the element ${name} names an association ${view.source} does not expose`, ...at});
  }
  // **A view's consumers are GENERATED, so at check time they are stale.**
  // Measured: rename a field and five candidates are found -- the registry,
  // the source class, a DPC -- and not one of them fails its own check,
  // because they still hold the previous shape and are consistent with each
  // other. The build then fails, naming a consumer and never the view.
  //
  // So the shape change is named here, where the person is: the field that
  // the generation exposes and the source no longer has. This is the
  // sentence the build never says.
  const generated = registry.getObject("VIEW", view.sqlView);
  if (generated !== undefined) {
    const exposed = [...(generated.parseType?.(registry)?.getComponents?.() ?? [])].map((c) => c.name.toUpperCase());
    // the generator's own field list, the client it adds included
    const now = new Set(viewFieldsOf(view).map((f) => String(f.name).toUpperCase()));
    const gone = exposed.filter((c) => !now.has(c));
    if (gone.length > 0) {
      issues.push({severity: "W", rule: "cds",
        message: `${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} in the generated view ` +
          `${view.sqlView} and no longer in ${view.name}: whatever reads ${gone.length === 1 ? "it" : "them"} ` +
          "breaks when this is generated again", ...at});
    }
  }
  if (view.write?.asked === true && view.write?.writable !== true) {
    issues.push({severity: "W", rule: "cds",
      message: `the view asks to be written and is not: ${view.write.why}`, ...at});
  }
  return issues;
}
