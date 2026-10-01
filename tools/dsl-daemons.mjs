#!/usr/bin/env node
// L1 model facts for abapGit daemon channel files.
export function programId(program, kind = "class") {
  if (!["class", "report", "function_group"].includes(kind)) throw new Error(`invalid authority kind ${kind}`);
  if (program?.startsWith("/")) throw new Error(`namespaced ${kind} ${program} cannot use the unnamespaced PROGRAM_ID rule`);
  const maxLength = kind === "function_group" ? 26 : 30;
  if (typeof program !== "string" || !new RegExp(`^[A-Z][A-Z0-9_]{0,${maxLength - 1}}$`).test(program)) {
    throw new Error(`invalid ${kind} name ${program}`);
  }
  if (kind === "report") return program;
  if (kind === "function_group") return `SAPL${program}`;
  return `${program.padEnd(30, "=")}CP`;
}

export function buildDaemonModel(model) {
  const result = structuredClone(model);
  if (!["samc", "sapc"].includes(result.kind)) throw new Error(`kind must be samc or sapc`);
  if (result.kind === "samc" && !Array.isArray(result.channels)) throw new Error(`samc channels must be an array`);
  if (result.kind === "samc" && !Array.isArray(result.authorities)) throw new Error(`samc authorities must be an array`);
  for (const channel of result.channels ?? []) {
    if (typeof channel.scope !== "string" || !channel.scope.trim()) throw new Error(`scope (SCOPE) is required on ${channel["@id"]}`);
    if (typeof channel.messageType !== "string" || !channel.messageType.trim()) throw new Error(`messageType (MESSAGE_TYPE_ID) is required on ${channel["@id"]}`);
  }
  // abapGit serialises the channels sorted by CHANNEL_ID whatever the input order (A4H capture, 2026-10-01).
  if (result.kind === "samc") result.channels.sort((a, b) => (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0));
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
    let previousNr = 0;
    for (const authority of result.authorities) {
      if (!Number.isSafeInteger(authority.nr) || authority.nr <= previousNr) throw new Error(`authority nr must be a unique ascending positive integer on ${authority["@id"]}`);
      previousNr = authority.nr;
      authority.kind ??= "class";
      const computed = programId(authority.program, authority.kind);
      if (authority.program_id !== undefined && authority.program_id !== computed) {
        throw new Error(`program_id ${authority.program_id} differs from computed ${authority.kind} PROGRAM_ID ${computed} for ${authority.program} on ${authority["@id"]}`);
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
