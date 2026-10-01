// Derive SAMC facts from abaplint syntax trees. Refuse facts the syntax cannot prove.
import {createRequire} from "node:module";
import {basename, join} from "node:path";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {registryFor} from "./dsl-ddic.mjs";
import {buildDaemonModel, programId} from "./dsl-daemons.mjs";
import {XMLParser} from "fast-xml-parser";

const {Expressions, Statements} = createRequire(import.meta.url)("@abaplint/core");
const types = new Map([["if_amc_message_producer_text", "TEXT"], ["if_amc_message_producer_binary", "BINARY"],
  ["if_amc_message_producer_pcp", "PCP"], ["if_amc_message_receiver_text", "TEXT"],
  ["if_amc_message_receiver_binary", "BINARY"], ["if_amc_message_receiver_pcp", "PCP"]]);
const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
const words = (node) => node.getTokens().map((token) => token.getStr());
const lower = (node) => node?.concatTokens().toLowerCase();
const place = (file, node) => ({file, line: node.getFirstToken().getStart().getRow()});

function filesIn(paths) {
  return paths.flatMap((path) => statSync(path).isDirectory()
    ? readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => entry.name === "node_modules" || entry.name === ".git" ? [] : filesIn([join(path, entry.name)]))
    : [path]).filter((file) => /\.(clas|prog|fugr|fgrp)(?:\..+)?\.abap$/i.test(file)).sort();
}

function literal(node) {
  if (!node) return undefined;
  const tokens = words(node);
  if (tokens[0]?.toLowerCase() === "value") tokens.shift();
  if (tokens.length !== 1) return undefined;
  const value = tokens[0];
  if (!(["'", "`"].includes(value[0]) && value.at(-1) === value[0])) return undefined;
  return value.slice(1, -1).replaceAll(value[0] + value[0], value[0]);
}

function constantValues(files) {
  const values = new Map();
  for (const item of files) {
    let owner = item.program.toLowerCase(), method = "";
    for (const st of item.statements) {
      const tokens = words(st).map((part) => part.toLowerCase());
      if (tokens[0] === "class" && (tokens.includes("definition") || tokens.includes("implementation"))) { owner = tokens[1]; method = ""; }
      if (st.get() instanceof Statements.MethodImplementation) method = lower(st.findDirectExpression(Expressions.MethodName)) ?? "";
      if (tokens[0] === "endmethod") method = "";
      if (tokens[0] === "endclass") { owner = item.program.toLowerCase(); method = ""; }
      if (!(st.get() instanceof Statements.Constant)) continue;
      const name = lower(st.findFirstExpression(Expressions.DefinitionName));
      const value = literal(st.findFirstExpression(Expressions.Value));
      if (name && value !== undefined) {
        const key = method ? `${owner}.${method}:${name}` : `${owner}:${name}`;
        if (values.has(key) && values.get(key) !== value) throw new Error(`${item.file}:${st.getStart().getRow()}: ambiguous constant ${key}`);
        values.set(key, value);
      }
    }
  }
  return values;
}

function resolved(node, owner, method, constants) {
  const value = literal(node);
  if (value !== undefined) return value;
  const parts = words(node ?? {getTokens: () => []}).map((part) => part.toLowerCase());
  if (parts.length === 1) return constants.get(`${owner}.${method}:${parts[0]}`) ?? constants.get(`${owner}:${parts[0]}`);
  if (parts.length === 3 && parts[1] === "=>") return constants.get(`${parts[0]}:${parts[2]}`);
  return undefined;
}

function parameters(call) {
  const out = new Map();
  for (const param of call.findAllExpressions(Expressions.ParameterS)) {
    const name = lower(param.findDirectExpression(Expressions.ParameterName));
    if (name) out.set(name, param.findDirectExpression(Expressions.Source));
  }
  return out;
}

function callSite(decl, file, line, method) {
  const sites = decl.callSites ?? {};
  return sites[`${file}:${line}`] ?? sites[`${basename(file)}:${line}`] ?? sites[`${method}`]
    ?? sites[`${method.toLowerCase()}`];
}

function idsFor(value, site, key, where) {
  const stated = site?.[key];
  const declared = stated === undefined ? undefined : Array.isArray(stated) ? stated : [stated];
  if (value === undefined && !declared?.length) throw new Error(`${where}: ${key} cannot be resolved statically; add a callSites entry`);
  if (value !== undefined && declared && (declared.length !== 1 || declared[0] !== value)) {
    throw new Error(`${where}: callSites ${key} conflicts with ABAP ${value}`);
  }
  return value === undefined ? declared : [value];
}

function typeOf(name, where, optional = false) {
  const type = types.get(name?.toLowerCase());
  if (!type && !optional) throw new Error(`${where}: AMC message type cannot be resolved statically`);
  return type;
}

function receiverType(interfaces, target, site, where) {
  const inferred = target === "me" && interfaces.length === 1 ? typeOf(interfaces[0], where) : undefined;
  if (inferred && site?.messageType && inferred !== site.messageType) throw new Error(`${where}: overlay messageType conflicts with receiver ${inferred}`);
  return inferred ?? site?.messageType;
}

function declaredTypes(statements) {
  const out = new Map();
  for (const st of statements) {
    if (!(st.get() instanceof Statements.Data)) continue;
    const tokens = words(st).map((token) => token.toLowerCase());
    const ix = tokens.indexOf("type");
    if (ix < 0) continue;
    const name = tokens[1] === ":" ? tokens[2] : tokens[1];
    const type = tokens[ix + 1] === "ref" && tokens[ix + 2] === "to" ? tokens[ix + 3] : tokens[ix + 1];
    if (name && type) out.set(name, type);
  }
  return out;
}

function sourceFile(file) {
  const name = basename(file).toLowerCase();
  const match = name.match(/^(.+?)\.(clas|prog|fugr|fgrp)(?:\..+)?\.abap$/);
  if (!match) throw new Error(`${file}: unsupported ABAP object file`);
  return {file, name: basename(file), program: match[1].toUpperCase(), kind: match[2] === "clas" ? "class" : match[2] === "prog" ? "report" : "function_group",
    source: readFileSync(file, "utf8")};
}

export function historicalAuthorities(file, applicationId) {
  const xml = new XMLParser({parseTagValue: false}).parse(readFileSync(file, "utf8"));
  const samc = xml?.abapGit?.["asx:abap"]?.["asx:values"]?.SAMC;
  if (!samc || samc.HEADER?.APPLICATION_ID !== applicationId) throw new Error(`${file}: SAMC application ID differs from ${applicationId}`);
  const entries = samc.AUTHORITIES?.AMC_CHNL_AUTH ?? [];
  const rows = Array.isArray(entries) ? entries : [entries];
  const seen = new Set(), keys = new Set();
  return rows.map((row) => {
    const nr = Number(row.NR);
    if (!Number.isSafeInteger(nr) || nr < 1 || seen.has(nr)) throw new Error(`${file}: invalid or duplicate authority NR ${row.NR}`);
    const key = `${row.CHANNEL_ID}|${row.PROGRAM_ID}|${row.ACTIVITY}`;
    if (row.APPLICATION_ID !== applicationId || keys.has(key)) throw new Error(`${file}: invalid or duplicate historical authority ${key}`);
    seen.add(nr);
    keys.add(key);
    return {nr, key};
  });
}

export function deriveSamc(paths, applicationId, decl = {}, numberingFile, allowUnexplained = false) {
  if (!applicationId) throw new Error("--app is required");
  const inputs = filesIn(paths).map(sourceFile);
  const names = new Set();
  for (const item of inputs) {
    if (names.has(item.name.toLowerCase())) throw new Error(`duplicate ABAP file ${item.name}`);
    names.add(item.name.toLowerCase());
  }
  const registry = registryFor([], inputs.map(({name, source}) => ({name, source})));
  const files = inputs.map((item) => {
    const object = registry.getObject(item.kind === "class" ? "CLAS" : item.kind === "report" ? "PROG" : "FUGR", item.program);
    const syntax = object?.getABAPFiles?.().find((file) => file.getFilename() === item.name)
      ?? object?.getMainABAPFile?.();
    if (!syntax || (item.name.endsWith(".testclasses.abap") && syntax.getFilename() !== item.name)) {
      throw new Error(`${item.file}: abaplint did not attach the ABAP file to ${item.program}`);
    }
    return {...item, statements: syntax.getStatements()};
  });
  const constants = constantValues(files);
  const facts = [];
  const usedSites = new Set();
  for (const item of files) {
    let method = "";
    let ownerClass = item.program.toLowerCase();
    const classInterfaces = new Map();
    let definition = ownerClass;
    for (const statement of item.statements) {
      const tokens = words(statement).map((part) => part.toLowerCase());
      if (tokens[0] === "class" && tokens.includes("definition")) definition = tokens[1];
      if (statement.get() instanceof Statements.InterfaceDef) {
        const name = lower(statement.findDirectExpression(Expressions.InterfaceName));
        if (name?.startsWith("if_amc_message_receiver_")) classInterfaces.set(definition, [...(classInterfaces.get(definition) ?? []), name]);
      }
    }
    const firstMethod = item.statements.findIndex((st) => st.get() instanceof Statements.MethodImplementation);
    const globalVars = declaredTypes(firstMethod < 0 ? [] : item.statements.slice(0, firstMethod));
    let vars = new Map(globalVars);
    const consumers = new Map();
    const flushConsumer = (consumer) => {
      if (!consumer || consumer.delivered) return;
      if (consumer.site?.authority === "R" && consumer.site.deliveryProgram && consumer.messageType) {
        for (const channelId of consumer.channelIds) facts.push({channelId, activity: "R", messageType: consumer.messageType,
          kind: consumer.site.kind ?? "class", program: consumer.site.deliveryProgram, source: consumer.source});
        return;
      }
      throw new Error(`${consumer.source.file}:${consumer.source.line}: consumer delivery cannot be resolved; add callSites {messageType, deliveryProgram, authority: "R"}`);
      for (const channelId of consumer.channelIds) facts.push({channelId, messageType: consumer.messageType,
        kind: item.kind, program: item.program, source: consumer.source});
    };
    const flushConsumers = () => {
      for (const consumer of consumers.values()) flushConsumer(consumer);
      consumers.clear();
    };
    for (const st of item.statements) {
      const statementTokens = words(st).map((part) => part.toLowerCase());
      if (statementTokens[0] === "class" && (statementTokens.includes("definition") || statementTokens.includes("implementation"))) {
        ownerClass = statementTokens[1];
        method = "";
      }
      if (st.get() instanceof Statements.MethodImplementation) {
        flushConsumers();
        method = lower(st.findDirectExpression(Expressions.MethodName)) ?? "";
        vars = new Map(globalVars);
      }
      if (statementTokens[0] === "endmethod") method = "";
      if (statementTokens[0] === "endclass") { ownerClass = item.program.toLowerCase(); method = ""; }
      for (const [name, type] of declaredTypes([st])) vars.set(name, type);
      for (const call of st.findAllExpressions(Expressions.MethodCall)) {
        const name = lower(call.findDirectExpression(Expressions.MethodName));
        if (!["create_message_producer", "create_message_consumer", "start_message_delivery"].includes(name)) continue;
        const tokens = words(st).map((token) => token.toLowerCase());
        const methodIndex = tokens.indexOf(name);
        const owner = tokens[methodIndex - 2];
        const where = `${item.file}:${st.getStart().getRow()}`;
        const site = callSite(decl, item.file, st.getStart().getRow(), `${ownerClass}.${method}`);
        if (site) usedSites.add(site);
        if (site?.authority === "none") {
          if (typeof site.reason !== "string" || !site.reason.trim()) throw new Error(`${where}: authority none requires a reason`);
          const app = resolved(parameters(call).get("i_application_id"), ownerClass, method, constants);
          if (app !== applicationId) throw new Error(`${where}: authority none application ID does not match ${applicationId}`);
          if (name === "start_message_delivery") throw new Error(`${where}: authority none belongs on the consumer creation call`);
          const params = parameters(call);
          const channelIds = idsFor(resolved(params.get("i_channel_id"), ownerClass, method, constants), site, "channelIds", where);
          const target = tokens[0];
          const castAt = tokens.indexOf("cast");
          const inferred = castAt >= 0 ? tokens[castAt + 1] : vars.get(target);
          const messageType = site.messageType ?? (inferred ? typeOf(inferred, where, true) : undefined);
          if (!messageType) throw new Error(`${where}: authority none needs messageType`);
          for (const channelId of channelIds) facts.push({channelId, messageType, kind: item.kind, program: item.program, source: place(item.file, st)});
          continue;
        }
        if (name === "start_message_delivery") {
          const consumer = consumers.get(owner);
          if (!consumer) continue;
          const callParams = parameters(call);
          const target = lower(callParams.get("i_receiver")) ?? words(call.findFirstExpression(Expressions.MethodCallParam) ?? call)
            .filter((token) => token !== "(" && token !== ")")[0]?.toLowerCase();
          const messageType = receiverType(classInterfaces.get(ownerClass) ?? [], target, site, where) ?? consumer.messageType;
          if (!messageType) throw new Error(`${where}: consumer receiver messageType cannot be resolved; add callSites messageType`);
          if (consumer.messageType && messageType !== consumer.messageType) throw new Error(`${where}: consumer messageType conflicts with receiver ${messageType}`);
          for (const channelId of consumer.channelIds) facts.push({channelId, activity: "R", messageType, kind: item.kind,
            program: item.program, source: consumer.source});
          consumer.delivered = true;
          continue;
        }
        if (owner !== "cl_amc_channel_manager") continue;
        const params = parameters(call);
        const apps = idsFor(resolved(params.get("i_application_id"), ownerClass, method, constants), site, "applicationIds", where);
        if (!apps.includes(applicationId)) continue;
        const channelIds = idsFor(resolved(params.get("i_channel_id"), ownerClass, method, constants), site, "channelIds", where);
        const source = place(item.file, st);
        if (name === "create_message_consumer") {
          const target = tokens[0] === "data" ? tokens[2] : tokens[0];
          flushConsumer(consumers.get(target));
          consumers.set(target, {channelIds, source, messageType: site?.messageType, site, delivered: false});
        } else {
          const target = tokens[0];
          const castAt = tokens.indexOf("cast");
          const inferred = castAt >= 0 ? tokens[castAt + 1] : vars.get(target);
          const messageType = inferred ? (typeOf(inferred, where, true) ?? site?.messageType) : site?.messageType;
          if (!messageType) throw new Error(`${where}: producer static messageType cannot be resolved; add callSites messageType`);
          if (site?.messageType && site.messageType !== messageType) throw new Error(`${where}: overlay messageType conflicts with ABAP ${messageType}`);
          for (const channelId of channelIds) facts.push({channelId, activity: "S", messageType, kind: item.kind,
            program: item.program, source});
        }
      }
    }
    flushConsumers();
  }
  for (const [key, site] of Object.entries(decl.callSites ?? {})) {
    if (!usedSites.has(site)) throw new Error(`callSites ${key} does not match an AMC call`);
  }
  const channels = new Map(), authorities = new Map();
  const add = (fact) => {
    const channel = channels.get(fact.channelId) ?? {"@id": `samc/${applicationId}/ch${fact.channelId}`, channelId: fact.channelId,
      scope: decl.channels?.[fact.channelId]?.scope, messageType: fact.messageType, source: []};
    if (channel.messageType && fact.messageType && channel.messageType !== fact.messageType) {
      throw new Error(`${fact.source?.file ?? "overlay"}: ${fact.channelId} message type ${fact.messageType} conflicts with ${channel.messageType}`);
    }
    channel.messageType ??= fact.messageType;
    if (fact.source && !channel.source.some((p) => p.file === fact.source.file && p.line === fact.source.line)) channel.source.push(fact.source);
    channels.set(fact.channelId, channel);
    if (fact.activity) {
      const key = `${fact.channelId}|${programId(fact.program, fact.kind)}|${fact.activity}`;
      const authority = authorities.get(key) ?? {channelId: fact.channelId, kind: fact.kind, program: fact.program,
        activity: fact.activity, source: []};
      if (fact.source && !authority.source.some((p) => p.file === fact.source.file && p.line === fact.source.line)) authority.source.push(fact.source);
      authorities.set(key, authority);
    }
  };
  for (const fact of facts) add(fact);
  for (const [channelId, meta] of Object.entries(decl.channels ?? {})) {
    if (!channels.has(channelId)) throw new Error(`overlay channel ${channelId} has no ABAP call`);
    if (meta.messageType && meta.messageType !== channels.get(channelId).messageType) throw new Error(`overlay ${channelId} messageType conflicts with ABAP`);
  }
  for (const extra of decl.extraAuthorities ?? []) {
    if (typeof extra.reason !== "string" || !extra.reason.trim()) throw new Error(`overlay authority ${extra.channelId}: reason is required`);
    if (!channels.has(extra.channelId)) throw new Error(`overlay authority ${extra.channelId} has no channel`);
    if (!["S", "R", "C"].includes(extra.activity)) throw new Error(`invalid activity ${extra.activity}`);
    if (extra.messageType && extra.messageType !== channels.get(extra.channelId).messageType) throw new Error(`overlay authority ${extra.channelId} messageType conflicts with ABAP`);
    add({...extra, kind: extra.kind ?? "class", messageType: channels.get(extra.channelId).messageType});
  }
  for (const row of channels.values()) {
    if (!row.scope) throw new Error(`${row.channelId}: scope is required in overlay`);
    row.source.sort(order);
  }
  const authRows = [...authorities.values()].sort((a, b) => a.channelId.localeCompare(b.channelId)
    || programId(a.program, a.kind).localeCompare(programId(b.program, b.kind)) || a.activity.localeCompare(b.activity));
  if (numberingFile) {
    const history = historicalAuthorities(numberingFile, applicationId);
    const current = new Map(authRows.map((row) => [`${row.channelId}|${programId(row.program, row.kind)}|${row.activity}`, row]));
    for (const old of history) {
      const row = current.get(old.key);
      if (!row) {
        if (allowUnexplained) continue;
        throw new Error(`${numberingFile}: authority drift: NR ${old.nr} ${old.key} is no longer derived`);
      }
      row.nr = old.nr;
      current.delete(old.key);
    }
    let next = Math.max(0, ...history.map((row) => row.nr));
    for (const row of current.values()) row.nr = ++next;
    authRows.sort((a, b) => a.nr - b.nr);
  } else authRows.forEach((row, index) => { row.nr = index + 1; });
  authRows.forEach((row) => { row["@id"] = `samc/${applicationId}/auth/${row.nr}`; row.source.sort(order); });
  return buildDaemonModel({"@id": `samc/${applicationId}`, kind: "samc", applicationId, version: decl.version ?? "A",
    description: decl.description ?? "", lang: decl.lang ?? "", channels: [...channels.values()], authorities: authRows});
}
