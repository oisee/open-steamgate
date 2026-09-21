#!/usr/bin/env node
// A deliberately small milestone notifier. Secrets stay in .local/, never in
// argv, Git, captures or marker files.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const DEFAULT_CONFIG = ".local/telegram.env";
const MARKERS = ".local/milestones";

export function parseEnvText(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function setEnvValue(text, key, value) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const prefix = `${key}=`;
  const replacement = `${key}=${value}`;
  const kept = lines.filter((line) => !line.trimStart().startsWith(prefix));
  kept.push(replacement);
  return kept.join("\n").replace(/\n*$/, "\n");
}

function configPath() {
  return resolve(process.env.OSG_TELEGRAM_ENV || DEFAULT_CONFIG);
}

function readConfig() {
  const file = configPath();
  if (!existsSync(file)) {
    throw new Error(`Telegram config is missing: ${file}`);
  }
  chmodSync(file, 0o600);
  const text = readFileSync(file, "utf8");
  return {file, text, values: parseEnvText(text)};
}

function atomicWrite(file, text) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, text, {mode: 0o600, flag: "wx"});
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, {force: true});
    throw error;
  }
}

export function redact(text, secrets) {
  let safe = String(text || "");
  for (const secret of secrets.filter(Boolean)) {
    safe = safe.split(String(secret)).join("[redacted]");
  }
  return safe;
}

async function telegram(token, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    // A fetch error may contain its URL, and the URL contains the token.
    throw new Error(`Telegram ${method} transport failed (${error.cause?.code || error.name || "network"})`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    const description = redact(body.description || `HTTP ${response.status}`, [
      token,
      payload.chat_id,
    ]);
    throw new Error(`Telegram ${method} failed: ${description}`);
  }
  return body.result;
}

async function send(values, text) {
  const token = values.OSG_TELEGRAM_BOT_TOKEN;
  const chatId = values.OSG_TELEGRAM_CHAT_ID;
  if (!token) throw new Error("OSG_TELEGRAM_BOT_TOKEN is empty");
  if (!chatId) throw new Error("OSG_TELEGRAM_CHAT_ID is empty; run setup after sending /start");
  if (text.length > 4000) throw new Error("Telegram milestone message exceeds 4000 characters");
  await telegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: {is_disabled: true},
  });
}

export function selectSetupChat(updates) {
  const privateChats = new Map();
  for (const update of updates) {
    const chat = update.message?.chat || update.channel_post?.chat;
    if (chat?.type === "private") privateChats.set(String(chat.id), chat);
  }
  if (privateChats.size === 0) {
    throw new Error("No private Telegram chat update found; open the bot, send /start, then retry setup");
  }
  if (privateChats.size > 1) {
    throw new Error("More than one private Telegram chat contacted this bot; refusing to choose a recipient");
  }
  return [...privateChats.values()][0];
}

async function setup() {
  const config = readConfig();
  const token = config.values.OSG_TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Put OSG_TELEGRAM_BOT_TOKEN in .local/telegram.env first");
  const updates = await telegram(token, "getUpdates", {
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
  });
  const chat = selectSetupChat(updates);
  const next = setEnvValue(config.text, "OSG_TELEGRAM_CHAT_ID", String(chat.id));
  atomicWrite(config.file, next);
  await send(parseEnvText(next), "✅ OSG milestone notifications connected.");
  console.log("Telegram chat saved; test notification delivered.");
}

function gitFact(args, fallback) {
  try {
    return execFileSync("git", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function milestone(id, message) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id || "")) {
    throw new Error("Milestone id must contain only letters, digits, dot, dash or underscore");
  }
  if (!message) throw new Error("Milestone message is required");
  const marker = resolve(MARKERS, `${id}.json`);
  const claim = resolve(MARKERS, `${id}.claim`);
  if (existsSync(marker)) {
    console.log(`Milestone ${id} was already notified; nothing sent.`);
    return;
  }
  mkdirSync(MARKERS, {recursive: true});
  try {
    mkdirSync(claim);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Milestone ${id} has an in-progress or uncertain delivery claim; not sending twice`);
    }
    throw error;
  }
  const branch = gitFact(["branch", "--show-current"], "detached");
  const commit = gitFact(["rev-parse", "--short", "HEAD"], "unknown");
  const dirty = gitFact(["status", "--porcelain"], "") !== "";
  const identity = `${branch} @ ${commit}${dirty ? " +dirty" : ""}`;
  const text = `🎯 OSG milestone reached: ${id}\n${message}\n${identity}`;
  try {
    await send(readConfig().values, text);
  } catch (error) {
    throw new Error(`${error.message}; delivery claim retained for manual resolution`);
  }
  atomicWrite(marker, JSON.stringify({
    id,
    message,
    branch,
    commit,
    dirty,
    notifiedAt: new Date().toISOString(),
  }, null, 2) + "\n");
  rmSync(claim, {recursive: true});
  console.log(`Milestone ${id} notification delivered.`);
}

function usage() {
  console.log("Usage:");
  console.log("  node tools/osd-telegram-notify.mjs setup");
  console.log("  node tools/osd-telegram-notify.mjs send-test");
  console.log("  node tools/osd-telegram-notify.mjs milestone <id> <message>");
}

async function main(args) {
  const [command, id, ...words] = args;
  if (command === "setup") return setup();
  if (command === "send-test") {
    await send(readConfig().values, "✅ OSG Telegram notification test passed.");
    console.log("Test notification delivered.");
    return;
  }
  if (command === "milestone") return milestone(id, words.join(" ").trim());
  usage();
  if (command) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`osd-telegram-notify: ${error.message}`);
    process.exitCode = 1;
  });
}
