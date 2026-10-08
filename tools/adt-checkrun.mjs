// Shared analysis only: ADT request scanning and documents belong to the routes.
import {TYPES} from "./osd-store-types.mjs";
import {portabilityWarnings} from "./amdp-gen.mjs";
import {frameUri, uriOf} from "./adt-documents.mjs";

// Diagnostic resources are independent of the triggering URI. Includes are
// already source resources; only an object root needs /source/main.
function sourceUri(object) {
  const root = uriOf(object.type, object.name);
  const include = object.type === "CLAS"
    ? object.include ?? object.uri?.match(/^\/sap\/bc\/adt\/oo\/classes\/[^/]+\/includes\/([^/?#]+)/)?.[1]
    : undefined;
  return include && include !== "main" ? `${root}/includes/${include}` : `${root}/source/main`;
}
function diagnosticUri(issue, object) {
  if (object.type === "INCL" && (!issue.type || issue.type === "INCL"
      || (issue.type === "PROG" && issue.name?.toUpperCase() === object.name.toUpperCase()))) {
    return uriOf("INCL", object.name);
  }
  const framed = frameUri(issue.file, issue.line, issue.column, {sourceMain: true})?.split("#start=")[0];
  return framed?.replace(/(\/includes\/[^/]+)\/source\/main$/, "$1")
    ?? sourceUri(issue.type ? {type: issue.type, name: issue.name} : object);
}

export async function checkRunReport(store, object, configured = process.env.STG_DB ?? "sqlite") {
  try {
    if (TYPES[object.type]?.source !== true) {
      store.read(object.type, object.name);
      return {status: "processed", issues: [], statusText: "no dictionary check here; the object is present and readable"};
    }
    const result = await store.checkWarm?.(object) ?? store.check(object.type, object.name, {source: object.source, include: object.include});
    const source = object.source ?? (object.type === "CLAS" ? store.read(object.type, object.name)?.source : undefined);
    const engine = ["file", "memory", "sqljs"].includes(configured) ? "sqlite" : configured;
    const warnings = object.type === "CLAS" && (object.include === undefined || object.include === "main") && source
      ? portabilityWarnings(source, `${object.name.toLowerCase()}.clas.abap`, store, engine) : [];
    return {status: "processed", issues: [...result.issues, ...warnings].map((issue) => ({
      severity: issue.severity ?? "E", line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message, uri: diagnosticUri(issue, object),
    }))};
  } catch (error) {
    return {status: "notProcessed", issues: [], statusText: String(error?.message ?? error)};
  }
}
