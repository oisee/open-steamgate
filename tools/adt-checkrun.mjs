// Shared analysis only: ADT request scanning and documents belong to the routes.
import {TYPES} from "./osd-store-types.mjs";
import {portabilityWarnings} from "./amdp-gen.mjs";

export function checkRunReport(store, object, configured = process.env.STG_DB ?? "sqlite") {
  try {
    if (TYPES[object.type]?.source !== true) {
      store.read(object.type, object.name);
      return {status: "processed", issues: [], statusText: "no dictionary check here; the object is present and readable"};
    }
    const result = store.check(object.type, object.name, {source: object.source, include: object.include});
    const source = object.source ?? (object.type === "CLAS" ? store.read(object.type, object.name)?.source : undefined);
    const engine = ["file", "memory", "sqljs"].includes(configured) ? "sqlite" : configured;
    const warnings = object.type === "CLAS" && (object.include === undefined || object.include === "main") && source
      ? portabilityWarnings(source, `${object.name.toLowerCase()}.clas.abap`, store, engine) : [];
    return {status: "processed", issues: [...result.issues, ...warnings].map((issue) => ({
      severity: issue.severity ?? "E", line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message,
    }))};
  } catch (error) {
    return {status: "notProcessed", issues: [], statusText: String(error?.message ?? error)};
  }
}
