#!/usr/bin/env node
// L1 model facts for abapGit daemon channel files.
export function programId(program) {
  if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(program)) throw new Error(`invalid class name ${program}`);
  return `${program.padEnd(30, "=")}CP`;
}

export function buildDaemonModel(model) {
  const result = structuredClone(model);
  for (const row of [...(result.channels ?? []), ...(result.authorities ?? [])]) {
    row.applicationId = result.applicationId;
    row.version = result.version;
  }
  if (result.authorities) {
    for (const authority of result.authorities) {
      const computed = programId(authority.program);
      if (authority.program_id !== undefined && authority.program_id !== computed) {
        throw new Error(`program_id differs from ${authority.program} on ${authority["@id"]}`);
      }
      authority.program_id = computed;
    }
  }
  if (result.stateful !== undefined) result.statefulXml = result.stateful ? "X" : "";
  return result;
}

export function traceNodes(model, trace) {
  const nodeAt = (path) => {
    const parts = path.split("/").filter(Boolean);
    let value = model;
    let node = model["@id"];
    for (const part of parts) {
      value = Array.isArray(value) ? value[Number(part) - 1] : value?.[part];
      if (value?.["@id"]) node = value["@id"];
    }
    return node;
  };
  return trace.map((entry) => ({...entry, node: nodeAt(entry.path)}));
}
