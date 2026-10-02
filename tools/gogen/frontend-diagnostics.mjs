import {isWarnedKernelDiagnostic} from "../osd-unit-ci.mjs";

// Keep parser and syntax diagnostics when tolerant compilation omits an object.
export function syntaxDiagnostics(registry, ours, objectName, session) {
  return (session ? (session.issues ??= registry.findIssues()) : registry.findIssues())
    .filter((issue) => ["check_syntax", "parser_error"].includes(issue.getKey()) && ours(issue.getFilename()))
    .filter((issue) => !isWarnedKernelDiagnostic(issue))
    .map((issue) => ({object: objectName(issue.getFilename()).toUpperCase(),
      message: `${issue.getFilename()}:${issue.getStart().getRow()}: ${issue.getMessage()}`}));
}
