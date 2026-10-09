export function reconcile(expected, actual) {
  const key = (r) => `${r.class}/${r.testclass}/${r.method}`;
  const got = new Map(actual.map((r) => [key(r), r]));
  return expected.map((r) => {
    const found = got.get(key(r));
    return found ? {...r, status: found.status, message: found.message, ...(found.where ? {where: found.where} : {}), ...(found.source ? {source: found.source} : {})}
      : {...r, source: "harness", status: "FAILED", message: "runner dropped this method"};
  });
}

// Go reports a killed compiler beneath a normally exited `go build`. Only
// tool invocation lines qualify; source-position diagnostics remain refusals.
export function killedGoTool(stderr = "") {
  return stderr.split("\n").some((line) => {
    const match = /^([\w./-]+): (\/[^:\r\n]+\/(?:compile|asm|link)(?:\.exe)?): signal: [a-z][a-z0-9 ]*\r?$/.exec(line);
    return !!match && !/\.(?:abap|go)$/.test(match[1]);
  });
}
export function markBuildFailure(ready, build) {
  const message = (build.stderr || build.error?.message || "go build failed").trim().split("\n").slice(0, 12).join("\n");
  const harness = build.signal || build.error || killedGoTool(build.stderr);
  for (const row of ready) {
    row.status = "NOT_COMPILED";
    if (harness) row.source = "harness";
    row.message = message;
  }
}
