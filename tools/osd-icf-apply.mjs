#!/usr/bin/env node
// Applying the objects to the registry, when they disagree with it.
//
//   node tools/osd-icf-apply.mjs --plan    what applying would do, and why
//
// **The rule is `docs/registry-drift.md` and it was written before this
// file.** Its three load-bearing claims, because a reader of this one should
// not have to go and get them:
//
//   - on a real system the objects ARE the table: `ICFSERVICE` and
//     `ICFHANDLER` are the registry and a `*.sicf.xml` is a transport;
//   - so the table is the truth at runtime and an object is applied **when
//     it arrives** -- when its content changed -- not on every start;
//   - and the disagreement keys off **who last wrote the row**.
//
// This file is the decision, on its own, as a pure function over three
// inputs: what the objects say, what the table holds, and where each row
// came from. Nothing here touches a database. That is deliberate -- the
// interesting part of the rule is which action is chosen, and a rule
// entangled with the writing of rows is a rule that can only be checked by
// writing rows.
import {icfRows} from "./osd-icf-rows.mjs";
import {createHash} from "node:crypto";
import {runsAs} from "./osd-main.mjs";

// Who last wrote a row. One letter, the way a system spells such a thing,
// and the column without which every case below is a guess.
export const SEEDED = "S";
export const EDITED = "E";

export const keyOf = (row) => `${row.ICF_NAME}|${row.ICFPARGUID}`;

/** What an object said, as one value, so "has it changed" is a comparison
 *  rather than a diff. The handler chain is part of it: a node whose class
 *  changed and whose URL did not has changed. */
export function contentHash(service, handlers) {
  const chain = handlers.map((h) => `${h.ICFORDER}:${h.ICFTYP}:${h.ICFHANDLER}`).sort().join(",");
  return createHash("sha1").update(JSON.stringify([service, chain])).digest("hex").slice(0, 16);
}

/** The five cases of the rule, as the actions they are.
 *
 *  `INSERT`   the table had no such node. A new object is how a node arrives.
 *  `REPLACE`  the row was still the object's own and the object changed.
 *             Quiet: nothing a person did was lost.
 *  `ASIDE`    the row was EDITED and the object contradicts it. The object
 *             wins -- it is the newer intent, and it is what a transport
 *             means -- and the previous row is kept and reported.
 *  `ORPHAN`   the row was EDITED and no object explains it any more. Kept,
 *             and reported: somebody made this node and a build did not.
 *  `REMOVE`   the row was SEEDED and its object is gone. It was only ever
 *             the object's.
 *
 *  And the sixth, which is the common one and the reason the rule says
 *  "when it arrives": `KEEP`, the object has not changed since it was
 *  applied. A start that re-applied everything would undo every edit. */
export function plan(objects, table, origins = new Map()) {
  const actions = [];
  const byKey = new Map(table.ICFSERVICE.map((r) => [keyOf(r), r]));
  const chainOf = (rows, key) => rows.ICFHANDLER.filter((h) => keyOf(h) === key);

  for (const service of objects.ICFSERVICE) {
    const key = keyOf(service);
    const handlers = chainOf(objects, key);
    const hash = contentHash(service, handlers);
    const was = byKey.get(key);
    const origin = origins.get(key);
    if (was === undefined) {
      actions.push({action: "INSERT", key, url: service.URL, service, handlers, hash});
      continue;
    }
    if (origin?.hash === hash) {
      // **The object has not changed since it was applied.** Whatever the
      // row says now -- including an edit -- stands. This is the case that
      // makes "writable" mean anything.
      actions.push({action: "KEEP", key, url: service.URL, hash,
        why: "the object has not changed since it was applied"});
      continue;
    }
    if (origin?.origin === EDITED) {
      actions.push({action: "ASIDE", key, url: service.URL, service, handlers, hash, previous: was,
        why: "the row was edited here and the object now says something else"});
      continue;
    }
    actions.push({action: "REPLACE", key, url: service.URL, service, handlers, hash});
  }

  const said = new Set(objects.ICFSERVICE.map(keyOf));
  for (const row of table.ICFSERVICE) {
    const key = keyOf(row);
    if (said.has(key)) continue;
    actions.push(origins.get(key)?.origin === EDITED
      ? {action: "ORPHAN", key, url: row.URL, row, why: "edited here, and no object explains it"}
      : {action: "REMOVE", key, url: row.URL, row});
  }
  return actions;
}

/** What a start says out loud. `never silently` is half the rule, and a rule
 *  whose reporting is left to the caller is a rule with a hole in it. */
export function report(actions) {
  const aside = actions.filter((a) => a.action === "ASIDE");
  const orphan = actions.filter((a) => a.action === "ORPHAN");
  const lines = [];
  for (const a of aside) {
    lines.push(`ICF ${a.url}: the object replaced a row edited here; the previous row is kept aside`);
  }
  for (const a of orphan) {
    lines.push(`ICF ${a.url}: edited here and no object explains it; kept`);
  }
  return lines;
}

// --- and the same decision, carried out against a database -------------

const quote = (v) => `'${String(v ?? "").replaceAll("'", "''")}'`;
const row = (table, values) => `INSERT INTO "${table}" (${Object.keys(values).map((k) => `"${k.toLowerCase()}"`).join(", ")}) `
  + `VALUES (${Object.values(values).map(quote).join(", ")});`;
const where = (a) => `"icf_name" = ${quote(a.key.split("|")[0])} AND "icfparguid" = ${quote(a.key.split("|")[1])}`;

/** What the registry holds right now. */
export async function currentRows(client) {
  // the eleven-method DatabaseClient answers `{rows}`, not an array -- the
  // shape the transpiler's runtime expects, and the one a caller writing
  // `.map` on the answer finds out about by exception
  const rows = async (sql) => ((await client.select({select: sql})).rows ?? []).map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k.toUpperCase()] = typeof v === "string" ? v.trimEnd() : v;
    return out;
  });
  return {
    ICFSERVICE: await rows(`SELECT * FROM icfservice`),
    ICFHANDLER: await rows(`SELECT * FROM icfhandler`),
  };
}

export async function currentOrigins(client) {
  const found = new Map();
  for (const r of (await client.select({select: `SELECT * FROM zosd_icf_origin`})).rows ?? []) {
    const name = String(r.ICF_NAME ?? r.icf_name ?? "").trimEnd();
    const parent = String(r.ICFPARGUID ?? r.icfparguid ?? "").trimEnd();
    found.set(`${name}|${parent}`, {
      origin: String(r.ORIGIN ?? r.origin ?? "").trimEnd(),
      hash: String(r.OBJHASH ?? r.objhash ?? "").trimEnd(),
    });
  }
  return found;
}

/** Apply the objects to the registry and say what that cost.
 *
 *  **The report is returned, not printed.** Who says it out loud is the
 *  host's business; that it is said is not optional, which is why an empty
 *  array is a different thing from a caller who did not ask. */
export async function applyTo(client, objects, options = {}) {
  const now = new Date().toISOString();
  const actions = plan(objects, await currentRows(client), await currentOrigins(client));
  const write = (sql) => client.execute(sql);

  for (const a of actions) {
    if (a.action === "KEEP") continue;
    if (a.action === "ORPHAN") continue;

    if (a.action === "ASIDE") {
      // kept, with a name and a time, so "aside" is a place and not a log
      // line the next restart overwrites
      await write(row("zosd_icf_aside", {
        ICF_NAME: a.previous.ICF_NAME, ICFPARGUID: a.previous.ICFPARGUID, CHANGED_AT: now,
        URL: a.previous.URL, HANDLER: a.previous.ICFHANDLER ?? "", WHY: a.why,
      }));
    }

    await write(`DELETE FROM "icfservice" WHERE ${where(a)};`);
    await write(`DELETE FROM "icfhandler" WHERE ${where(a)};`);
    if (a.action === "REMOVE") {
      await write(`DELETE FROM "zosd_icf_origin" WHERE ${where(a)};`);
      continue;
    }
    await write(row("icfservice", a.service));
    for (const h of a.handlers) await write(row("icfhandler", h));
    await write(`DELETE FROM "zosd_icf_origin" WHERE ${where(a)};`);
    await write(row("zosd_icf_origin", {
      ICF_NAME: a.service.ICF_NAME, ICFPARGUID: a.service.ICFPARGUID,
      ORIGIN: SEEDED, OBJHASH: a.hash, CHANGED_AT: now,
    }));
  }
  if (options.say !== undefined) for (const line of report(actions)) options.say(line);
  return {actions, report: report(actions)};
}

/** A row a person changed says so, and that is the only way the rule can
 *  tell an edit from a seed. Exported because whatever writes the registry
 *  from ABAP or from a screen has to call it -- a rule about what every
 *  writer must do lives in the module they import. */
export async function markEdited(client, name, parent) {
  const now = new Date().toISOString();
  // **The object's hash is kept, and the first version of this blanked it.**
  // Only the origin changes: the row is a person's now. "Has the object
  // changed since it was applied" is still a question that has to be
  // answerable, and with no hash to compare, every later apply read the
  // object as changed and set the edit aside -- so an edit did not survive
  // the next start even though nothing about the object had moved. Found by
  // the test that exists for exactly that case.
  const previous = (await currentOrigins(client)).get(`${name}|${parent}`);
  await client.execute(`DELETE FROM "zosd_icf_origin" WHERE "icf_name" = ${quote(name)} AND "icfparguid" = ${quote(parent)};`);
  await client.execute(row("zosd_icf_origin", {
    ICF_NAME: name, ICFPARGUID: parent, ORIGIN: EDITED, OBJHASH: previous?.hash ?? "", CHANGED_AT: now,
  }));
}

/** What a host does at startup, in one place because all of them must do it.
 *
 *  The shape is the lesson of `tools/osd-dialog-step.mjs`: a rule about what
 *  **every host must do** is not a comment saying so, it is a module they
 *  import. Three hosts wrote their own end-of-dialog-step once and two of
 *  them got it wrong.
 *
 *  **A failure here is loud and not fatal, and that is a statement with a
 *  shelf life.** Nothing routes off these rows yet -- the express hosts still
 *  mount from `tools/osd-nodes.mjs` reading the objects -- so a registry that
 *  could not be applied must not stop a listener that does not depend on it.
 *  The day routing asks the table, this becomes fatal, and the comment has to
 *  change with it rather than quietly stay true-sounding.
 *
 *  It needs a file system, because the objects are files. The browser preview
 *  has neither, so there the registry is simply empty until the rows are
 *  generated into the bundle -- which is the `CONTENT`/`HOST` distinction
 *  `tools/osd-nodes.mjs` already draws, showing up one layer down. */
export async function applyAtStartup(client, options = {}) {
  const say = options.say ?? ((line) => console.log(line));
  try {
    const {icfRows} = await import("./osd-icf-rows.mjs");
    const {actions, report: lines} = await applyTo(client, icfRows(options.root ?? process.cwd()));
    for (const line of lines) say(line);
    const changed = actions.filter((a) => a.action !== "KEEP").length;
    if (changed > 0) {
      say(`ICF registry: ${changed} of ${actions.length} nodes applied from their objects`);
    }
    return actions;
  } catch (e) {
    say(`ICF registry not applied: ${e?.message ?? e}. Nothing routes off it yet, so this is not fatal -- and it will be.`);
    return undefined;
  }
}

if (runsAs("osd-icf-apply.mjs")) {
  // With no table to read yet, the plan against an empty registry is what a
  // first apply would do -- which is the honest thing this can print today.
  const objects = icfRows(".");
  const actions = plan(objects, {ICFSERVICE: [], ICFHANDLER: []});
  const by = {};
  for (const a of actions) by[a.action] = (by[a.action] ?? 0) + 1;
  for (const a of actions) console.log(`${a.action.padEnd(8)} ${a.url}`);
  console.log(`\n${actions.length} actions: ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(", ")}.`);
  console.log("Against an empty registry, which is what a first apply sees. docs/registry-drift.md.");
}
