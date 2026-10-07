// Publication tickets belong to the source host, outside the serving child.
import {existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync} from "node:fs";
import {join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {mkdirDurable, writeDurable, renameDurable} from "./osd-durable.mjs";
import {warmVerdict} from "./osd-hot.mjs";

const journals = new Map();
const DAY = 24 * 60 * 60 * 1000;
const error = (code, message) => Object.assign(new Error(message), {code});
const warned = new WeakSet();
function checkpointFailure(owner, error) {
  owner.generationRecordingFailed = true;
  if (!warned.has(owner)) {
    warned.add(owner);
    console.warn(`publication checkpoint unavailable (${error.code ?? "ERROR"}); RUN_TESTS will refuse`);
  }
}

// Recording is diagnostic bookkeeping after publication, never a reason to
// fail the publication or leave its ticket pending. Keep a failed write
// visible to RUN_TESTS even if there was no older checkpoint on disk.
export function recordStoreGeneration(store, select) {
  try {
    const journal = activationJournal(store);
    journal.recordGenerationBestEffort(select(journal));
    // The journal owns recording failures; a later successful ticket update
    // clears them too. The store flag is only for failure to obtain a journal.
    store.generationRecordingFailed = false;
  } catch (error) { checkpointFailure(store, error); }
}

export function recordBaselineGeneration(store, fallback) {
  recordStoreGeneration(store, journal => journal.currentGeneration()
    ?? (store.inactive?.size ? "" : fallback()));
}
export class ActivationJournal {
  constructor(root, {now = () => Date.now(), host = "test"} = {}) {
    this.root = root;
    this.now = now;
    this.directory = join(root, ".local", "activation", host);
    this.file = join(this.directory, "operations.json");
    this.outcomeFile = join(this.directory, "last-outcomes.json");
    this.attemptFile = join(this.directory, "attempt-sequences.json");
    this.generationFile = join(this.directory, "published-generation.json");
    try { this.entries = JSON.parse(readFileSync(this.file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; this.entries = {}; }
    let migrate = false;
    try { this.outcomes = JSON.parse(readFileSync(this.outcomeFile, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; this.outcomes = {}; migrate = true; }
    try { this.attempts = JSON.parse(readFileSync(this.attemptFile, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; this.attempts = {}; }
    // Legacy tickets are in start order. Keep counters beyond ticket expiry.
    for (const entry of Object.values(this.entries)) {
      const key = `${entry.type} ${entry.name}`;
      const counter = this.attempts[key] ??= {sequence: 0};
      entry.attempt_seq ??= counter.sequence + 1;
      counter.sequence = Math.max(counter.sequence, entry.attempt_seq);
    }
    for (const [key, outcome] of Object.entries(this.outcomes)) {
      outcome.attempt_seq ??= this.entries[outcome.op_id]?.attempt_seq ?? 0;
      const counter = this.attempts[key] ??= {sequence: 0};
      counter.sequence = Math.max(counter.sequence, outcome.attempt_seq);
    }
    this.saveAttempts();
    for (const entry of Object.values(this.entries)) {
      if (!["published", "failed"].includes(entry.state)) {
        Object.assign(entry, {state: "failed", active: false, live: false, failure_stage: "recovery",
          note: "source host restarted before completion", updated_at: this.time(), completed_at: this.time()});
        this.rememberOutcome(entry);
      } else if (migrate) this.rememberOutcome(entry);
    }
    // Migrate before pruning expired history, including a failed old ticket.
    this.saveOutcomes();
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
  recordGenerationBestEffort(generation) {
    try {
      this.recordGeneration(generation);
      this.generationRecordingFailed = false;
    } catch (error) { checkpointFailure(this, error); }
  }
  rememberOutcome(entry) {
    const key = `${entry.type} ${entry.name}`;
    if ((this.outcomes[key]?.attempt_seq ?? -1) > entry.attempt_seq) return;
    this.outcomes[key] = {
      op_id: entry.op_id, attempt_seq: entry.attempt_seq, outcome: entry.state, generation: entry.generation_id,
      diagnostics: {failure_stage: entry.failure_stage, note: entry.note, issues: entry.issues,
        ...(entry.error ? {error: entry.error} : {})},
    };
  }
  saveAttempts() {
    mkdirDurable(this.directory);
    const temporary = `${this.attemptFile}.${process.pid}.tmp`;
    writeDurable(temporary, JSON.stringify(this.attempts));
    renameDurable(temporary, this.attemptFile);
  }
  saveOutcomes() {
    mkdirDurable(this.directory);
    const temporary = `${this.outcomeFile}.${process.pid}.tmp`;
    writeDurable(temporary, JSON.stringify(this.outcomes));
    renameDurable(temporary, this.outcomeFile);
  }
  lastOutcome(type, name) { return this.outcomes[`${type} ${String(name).toUpperCase()}`]; }
  forgetObject(type, name) {
    const key = `${type} ${String(name).toUpperCase()}`;
    delete this.outcomes[key];
    this.saveOutcomes();
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
    name = String(name).toUpperCase();
    const counter = this.attempts[`${type} ${name}`] ??= {sequence: 0};
    const attempt_seq = ++counter.sequence;
    this.saveAttempts();
    const entry = {state: "checked", op_id: randomUUID(), attempt_seq, generation_id: "", type, name,
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
    if (["published", "failed"].includes(entry.state)) {
      entry.completed_at = entry.updated_at;
      this.rememberOutcome(entry);
      this.saveOutcomes();
    }
    this.save();
    if (entry.state === "published") this.recordGenerationBestEffort(entry.generation_id);
    return {...entry};
  }
  lookup(id) {
    if (typeof id !== "string" || !id.trim()) throw error("INVALID_NAME", "ACTIVATION_STATUS needs op_id");
    this.save();
    const entry = Object.hasOwn(this.entries, id) ? this.entries[id] : undefined;
    if (!entry) throw error("NOT_FOUND", "activation operation not found or expired");
    const result = structuredClone(entry);
    // Operation history is immutable. Verification is a current observation
    // of the generation's cold-comparison sidecar, rather than a new state.
    if (entry.state === "published") {
      const generation = join(this.root, "build/by-input", entry.generation_id);
      result.verified = existsSync(join(generation, "manifest.json"))
        ? warmVerdict(generation) !== false : entry.verified ?? false;
    }
    return result;
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
