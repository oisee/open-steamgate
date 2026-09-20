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
