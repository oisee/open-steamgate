#!/usr/bin/env node
// L1 model facts for abapGit daemon channel files.
export function programId(program) {
  if (program?.startsWith("/")) throw new Error(`namespaced class ${program} cannot use the unnamespaced PROGRAM_ID rule`);
  if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(program)) throw new Error(`invalid class name ${program}`);
  return `${program.padEnd(30, "=")}CP`;
}

export function buildDaemonModel(model) {
  const result = structuredClone(model);
  if (!["samc", "sapc"].includes(result.kind)) throw new Error(`kind must be samc or sapc`);
  if (result.kind === "samc" && !Array.isArray(result.channels)) throw new Error(`samc channels must be an array`);
  if (result.kind === "samc" && !Array.isArray(result.authorities)) throw new Error(`samc authorities must be an array`);
  for (const row of [...(result.channels ?? []), ...(result.authorities ?? [])]) {
    for (const key of ["applicationId", "version"]) {
      if (row[key] !== undefined && row[key] !== result[key]) {
        throw new Error(`${key} differs from root on ${row["@id"]}`);
      }
    }
    row.applicationId = result.applicationId;
    row.version = result.version;
  }
  if (result.authorities) {
    for (const [index, authority] of result.authorities.entries()) {
      if (authority.nr !== index + 1) throw new Error(`authority nr must be ${index + 1} on ${authority["@id"]}`);
      const computed = programId(authority.program);
      if (authority.program_id !== undefined && authority.program_id !== computed) {
        throw new Error(`program_id differs from ${authority.program} on ${authority["@id"]}`);
      }
      authority.program_id = computed;
    }
  }
  result.has_text = Boolean(result.lang || result.description);
  result.has_description = Boolean(result.description);
  result.has_lang = Boolean(result.lang);
  if (result.kind === "samc") {
    result.has_channels = result.channels.length > 0;
    result.has_authorities = result.authorities.length > 0;
  } else {
    result.has_stateful = Boolean(result.stateful);
    result.statefulXml = result.has_stateful ? "X" : "";
  }
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
