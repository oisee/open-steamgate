// Publication tickets belong to the source host, outside the serving child.
import {mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";

const journals = new Map();
const DAY = 24 * 60 * 60 * 1000;
const error = (code, message) => Object.assign(new Error(message), {code});
export class ActivationJournal {
  constructor(root, {now = () => Date.now(), host = "test"} = {}) {
    this.now = now;
    this.directory = join(root, ".local", "activation", host);
    this.file = join(this.directory, "operations.json");
    this.generationFile = join(this.directory, "published-generation.json");
    try { this.entries = JSON.parse(readFileSync(this.file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; this.entries = {}; }
    for (const entry of Object.values(this.entries)) {
      if (!["published", "failed"].includes(entry.state)) {
        Object.assign(entry, {state: "failed", active: false, live: false, failure_stage: "recovery",
          note: "source host restarted before completion", updated_at: this.time(), completed_at: this.time()});
      }
    }
    this.save();
  }
  time() { return new Date(this.now()).toISOString(); }
  // build/live can move before promotion finishes. Retain the last confirmed
  // generation separately, including the baseline before the first activation.
  currentGeneration(fallback) {
    try { return JSON.parse(readFileSync(this.generationFile, "utf8")).generation_id; }
    catch (error) { if (error.code !== "ENOENT") throw error; return fallback; }
  }
  recordGeneration(generation) {
    mkdirSync(this.directory, {recursive: true});
    const temporary = `${this.generationFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({generation_id: generation ?? ""}));
    renameSync(temporary, this.generationFile);
  }
  save() {
    for (const [id, entry] of Object.entries(this.entries)) {
      if (entry.completed_at && this.now() - Date.parse(entry.completed_at) >= DAY) delete this.entries[id];
    }
    mkdirSync(this.directory, {recursive: true});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.entries));
    renameSync(temporary, this.file);
  }
  create(type, name) {
    const entry = {state: "checked", op_id: randomUUID(), generation_id: "", type, name,
      created_at: this.time(), updated_at: this.time(), completed_at: "", failure_stage: "",
      active: false, live: false, note: "", issues: []};
    this.entries[entry.op_id] = entry;
    this.save();
    return {...entry};
  }
  update(id, fields) {
    const entry = Object.hasOwn(this.entries, id) ? this.entries[id] : undefined;
    if (!entry) throw error("NOT_FOUND", "activation operation not found");
    if (entry.completed_at) return {...entry};
    Object.assign(entry, fields, {updated_at: this.time()});
    if (["published", "failed"].includes(entry.state)) entry.completed_at = entry.updated_at;
    this.save();
    if (entry.state === "published") this.recordGeneration(entry.generation_id);
    return {...entry};
  }
  lookup(id) {
    if (typeof id !== "string" || !id.trim()) throw error("INVALID_NAME", "ACTIVATION_STATUS needs op_id");
    this.save();
    const entry = Object.hasOwn(this.entries, id) ? this.entries[id] : undefined;
    if (!entry) throw error("NOT_FOUND", "activation operation not found or expired");
    return structuredClone(entry);
  }
}
export function activationJournal(store) {
  // Embedded source hosts and fixtures can own the journal's lifetime.
  if (store.activationJournal !== undefined) return store.activationJournal;
  if (!store.root) throw error("NOT_SUPPORTED", "activation tracking needs a source host");
  const root = resolve(store.root);
  const host = `http-${process.env.STG_PORT ?? `process-${process.pid}`}`;
  const key = join(root, host);
  if (!journals.has(key)) {
    const directory = join(root, ".local", "activation", host);
    mkdirSync(directory, {recursive: true});
    const ownerFile = join(directory, "owner.pid");
    try { writeFileSync(ownerFile, String(process.pid), {flag: "wx"}); }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const owner = Number(readFileSync(ownerFile, "utf8"));
      if (!Number.isInteger(owner) || owner <= 0) throw error("CONFLICT", "invalid activation journal owner");
      try { process.kill(owner, 0); }
      catch (alive) {
        if (alive.code !== "ESRCH") throw alive;
        const takeover = join(directory, "takeover.lock");
        try { mkdirSync(takeover); }
        catch { throw error("CONFLICT", "activation journal ownership takeover is busy"); }
        try {
          if (readFileSync(ownerFile, "utf8") !== String(owner)) throw error("CONFLICT", "activation journal owner changed");
          unlinkSync(ownerFile);
          writeFileSync(ownerFile, String(process.pid), {flag: "wx"});
        } finally {
          rmdirSync(takeover);
        }
      }
      if (owner !== process.pid && readFileSync(ownerFile, "utf8") !== String(process.pid)) {
        throw error("CONFLICT", "activation journal is owned by another source host");
      }
    }
    journals.set(key, new ActivationJournal(root, {host}));
  }
  return journals.get(key);
}
