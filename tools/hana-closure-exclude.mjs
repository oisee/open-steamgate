// What a validation finding names, and what the island may therefore
// exclude -- the classifier and the island-wide exclusion decision of the
// closure walk (H5x-1 fix round 2), beside the loop: tools/hana-closure.mjs
// stays the loop, this file is its own package so the size budget stays
// honest, the way tools/hana-closure-stubs.mjs and
// tools/hana-closure-merge.mjs are.
//
// Fix round 2 replaces fix round 1's per-file exclusion (decided inside
// planStubPass, on one file's findings at a time) with a decision over the
// whole island, taken only inside the stub rounds and only at the dumper
// fixed point (PR #933; the bed's run 15 excluded an object in iteration 3
// while its superclass was still pending from the dumper -- it arrived in
// iteration 4 -- and the whole EPM core fell one iteration after another):
//
// - nothing is excluded while any name of any finding in the island is
//   still pending -- unasked, or asked with no answer recorded (not
//   missing, not refused, not resolved). Deferred names of stubbed methods
//   are unasked and pending the same way. A merge refusal is answered (the
//   filtered-dump retry settles it in the iteration it happened; a later
//   dump carrying the name lifts it, and the per-iteration re-decision
//   un-excludes whatever it excluded).
// - the decision is per iteration: the loop clears the excluded set and
//   the records whenever the island grows, this module computes from
//   scratch, and the request's `excluded` key and the closure-stubs.json
//   definition records carry the LAST decision only.
// - a PRESENT name is answered only when the present object is CLEAN (no
//   definition-level findings of its own). A present-but-red name is a
//   cascade: follow the chain of present-but-red objects to its roots. A
//   root -- its findings name something answered-absent (a missing answer,
//   a merge refusal, asked and resolved but still failing) or name nothing
//   at all -- is excluded with level "definition". A file whose findings
//   are all cascades is recorded as {level: "cascade", of: [roots]} and is
//   NOT excluded on its own account: it falls out of the build only through
//   the build's own cascade (the transpiler reports it red once the root
//   is excluded), which the next stub round re-evaluates -- bottoms at
//   already-excluded objects then exclude it with
//   {level: "cascade", of, excluded: true}, so the build goes green. An
//   EXCLUDED name is never "answered" for its dependents; that is the same
//   cascade rule.
// - a group of present objects whose definition findings name only each
//   other (a true cycle: every member reaches itself through the others
//   and none has a root) is recorded as {level: "cycle", members} and
//   every member STAYS in the build -- the transpiler resolves a real
//   cycle when all members are present (measured on the run-15 knot), so
//   a residual cycle is a checker limit to report, and excluding any
//   member would kill whatever sits above it.
// - the walk's seed classes -- the MPC/DPC/_EXT pairs a registration
//   names (the gen/hana-segw facts or the island's *.iwsv.xml / *.iwmo.xml),
//   and without any registration every object of those suffixes -- are
//   never excluded: the decision throws and the run fails with the object
//   and its findings. That is the service itself, and a red build is the
//   honest answer.

// ------------------------------------------------------------ findings ----

// one line of the validation's own words: `rule, message[, fix], file:line`
// -- the fix and the message both carry commas, so the split is anchored on
// the tail: a fix is a single word, and the file is a comma-free,
// space-free, colon-free path followed by a line number. The build's log
// prefix (`osd-build: FAILED: `) is tolerated, so a build log parses the
// same way the thrown error does.
const FINDING = /^([a-z_]+), (.*?)(?:, ([A-Za-z][A-Za-z0-9_]*))?, ([^,\s:]+):(\d+)$/;

/** the findings of a validation message, in order, as
 *  {rule, message, fix, file, line, raw}. Lines that are not findings --
 *  build chatter, empty lines -- are dropped; classifying them is
 *  classifyFindings's job. Pure. */
export function parseFindings(message) {
  const findings = [];
  for (const raw of String(message ?? "").split("\n")) {
    const line = raw.replace(/^(?:osd-build|osd): FAILED: /, "");
    const m = FINDING.exec(line);
    if (m !== null) {
      findings.push({rule: m[1], message: m[2], fix: m[3], file: m[4], line: Number(m[5]), raw: line});
    }
  }
  return findings;
}

const NAME = "[A-Za-z0-9_/#$]+";

// a local variable's name, by the ABAP naming convention: LV_/LS_/LT_/LR_
// and the scope-letter families, every object ref *O_, RI_, CH_, ME_ (fix
// round 2: the bed asked five of these as TTYP under the Target type
// wording -- the name is the statement's target VARIABLE, never a type)
const LOCAL_VARIABLE = /^(?:[A-Z]O_|[LGECIRSA](?:V|S|T|R)_|RI_|CH_|ME_)/;

const cascadeOf = (message) => [
  [/^Method (?:or attribute )?"[^"]*" not found$/, "method"],
  [/^Component "[^"]*" not found in structure$/, "component"],
  [/^Not an object reference/, "reference"],
  [/^"[^"]*" not found$/, "fugr-signature"],
  [/not a table type [A-Za-z0-9_/#$]+$/, "local-type"],
  [/ not found in class or interface$/, "local-type"],
  [/contains unknown: Select, [A-Za-z]+ not found$/, "select-type"],
  [/contains unknown: Type error,/, "type-error"],
  // round 7 (bed run 10's shapes): cascades of an unknown type or class
  [/^Definition for "[^"]*" not found in scope\([A-Za-z]+\)$/, "scope"],
  [/^Method parameter type not(?: compatible)?$/, "param-type"],
  [/^[^,]+ cannot be instantiated, class is defined as(?: protected)?$/, "protected"],
].find(([re]) => re.test(message));

// an abapGit file name's object part to the name it stands for: the
// namespace is escaped as #ns#, one rule for both directions
// (tools/hana-ddic-map.mjs abapGitFileName)
export const nameFromAbapFile = (part) => part.replace(/^#([^#]+)#/, "/$1/").toUpperCase();
// INTF or CLAS is a NAME-PREFIX heuristic (`if*` -> INTF, anything else
// CLAS), not a TADIR lookup: on the measured log every name in these shapes
// is IF_*, so it is correct there, but a dictionary object dragged into a
// type chain would be asked as CLAS and come back as a wrong-kind gap (the
// dumper answers what the TADIR kind names, and reports the rest missing).
const objectKind = (name) => (/^if/i.test(name) ? "intf" : "clas");
// `X unknown` (unknown_types, bed run 5's shape): the kind is the name's
// prefix -- CLAS for a CL_/CX_ prefix, INTF for IF_/ZIF_, else the ddic
// triple; a namespace /NS/NAME is stripped first.
const unknownKind = (name) => {
  const bare = name.replace(/^\/[^/]+\//, "");
  if (/^(?:z?cl|z?cx)_/i.test(bare)) return "clas";
  if (/^(?:z?if)_/i.test(bare)) return "intf";
  return "ddic";
};

/** what a validation asks for: `names` carries every requestable name with
 *  its kind (tabl/dtel/doma/ddic -- the DDIC the dumper resolves --
 *  and clas/intf/fugr) and the first finding that named it, in
 *  first-named order, de-duplicated; `cascades` counts the findings whose
 *  name is not the thing that is missing; `unclassified` carries the raw
 *  lines this classifier has no shape for, so a new transpiler wording is
 *  visible instead of silently dropped. Pure. */
export function classifyFindings(findings) {
  const names = [];
  const seen = new Set();
  let cascades = 0;
  const unclassified = [];
  const ask = (name, kind, finding) => {
    if (/^[A-Z0-9_/#$]+$/.test(name) === false || seen.has(name)) return;
    seen.add(name);
    // the message rides beside the raw line: the SHLP decision reads the
    // message only, never the raw's file name (round 5, critic r4 S-3)
    names.push({name, kind, finding: finding.raw, message: finding.message});
  };
  for (const finding of findings) {
    const {message, fix, file} = finding;
    let m;
    if ((m = new RegExp(`^Database table or view "(${NAME})" not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "tabl", finding);
    } else if ((m = new RegExp(`field not part of structure (${NAME})-`).exec(message))) {
      ask(m[1].toUpperCase(), "tabl", finding);
    } else if ((m = new RegExp(`^Contains unknown, (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`contains unknown: (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), fix === "lookupDataElement" ? "dtel" : "ddic", finding);
    } else if (fix === "lookupDomain" && (m = new RegExp(`contains unknown: (${NAME})$`).exec(message))) {
      // the domain lookup reports no "not found": its fix field is the shape
      ask(m[1].toUpperCase(), "doma", finding);
    } else if ((m = new RegExp(`^(${NAME}) unknown$`).exec(message)) !== null) {
      // bed run 5's shape: a type named bare-unknown (`X unknown`, seen in
      // an .intf.abap file) -- the kind is the name's prefix
      ask(m[1].toUpperCase(), unknownKind(m[1]), finding);
    } else if ((m = new RegExp(`^Friend class (${NAME}) does not exist$`).exec(message))) {
      // its check_syntax neighbour: a FRIENDS declaration naming a class
      // the tree does not have
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`^(${NAME}) not found$`).exec(message)) !== null) {
      // the bare shape: a type name alone (`X not found`), the way a missing
      // table type surfaces
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`not a table type, (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`^Class (${NAME}) not found$`).exec(message))) {
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`^Unknown class (${NAME})$`).exec(message))) {
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = new RegExp(`^CATCH, unknown class (${NAME})$`).exec(message))) {
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`^RAISE, unknown class (${NAME})$`).exec(message))) {
      // RAISE EXCEPTION TYPE x with x not in the build -- the shape a stub
      // raise produces when the stub's own class is missing (round 3's cap
      // path leaves it in the request)
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = new RegExp(`could not resolve top (${NAME})$`, "i").exec(message))) {
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = /contains unknown: could not resolve top$/i.exec(message)) !== null &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(fix ?? "") === true) {
      // the line's comma-parse can put the name in the fix field (bed run
      // 13's shape): `Variable "X" contains unknown: Could not resolve top
      // Y` parses with the message cut at "top" and Y as the fix -- Y is
      // the type, the variable X is never asked
      ask(fix.toUpperCase(), objectKind(fix), finding);
    } else if ((m = new RegExp(`unable to resolve (${NAME})$`).exec(message)) !== null) {
      // `Variable "X" contains unknown: REF, unable to resolve <name>` (and
      // the bare shape): <name> is the missing type, the variable X is
      // never asked (fix round 2 pins this with the fixture wordings)
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if ((m = new RegExp(`^Super class "(${NAME})" not found or contains(?: errors)?$`).exec(message))) {
      // bed run 10's shape (round 7): an island class's superclass is not
      // in the build -- the class itself is the request (the line's parse
      // reads the last comma-word as the fix field, so `errors` may have
      // left the message)
      ask(m[1].toUpperCase(), "clas", finding);
    } else if ((m = new RegExp(`^Target type unknown, (${NAME})$`).exec(message)) !== null) {
      // round 7's kind-less triple for a name outside the local-variable
      // convention; a local variable's name is a CASCADE, counted, never
      // asked (fix round 2: the wording names the statement's target
      // VARIABLE -- the bed asked five of these as TTYP and they became
      // gaps; this branch is the one that fires, the cascadeOf fallback
      // never sees the message)
      const name = m[1].toUpperCase();
      if (LOCAL_VARIABLE.test(name) === true) cascades++;
      else ask(name, "ddic", finding);
    } else if (message === "Target type unknown" && /^[A-Za-z][A-Za-z0-9_]*$/.test(fix ?? "") === true) {
      // the parse may read the name as the line's fix field (bed run 15's
      // own parse shape) -- the same local-variable rule applies there
      if (LOCAL_VARIABLE.test(fix.toUpperCase()) === true) cascades++;
      else ask(fix.toUpperCase(), "ddic", finding);
    } else if ((m = new RegExp(`^resolveConstantValue, not found: (${NAME})$`, "i").exec(message)) !== null) {
      // bed run 15's hole: a constant resolved off a class or interface the
      // tree does not have -- X is THAT name (a code kind). With no branch
      // the finding was nameless, nameless counted as answered, and the
      // naming interface was excluded without ever being asked
      ask(m[1].toUpperCase(), objectKind(m[1]), finding);
    } else if (message.startsWith("Statement does not exist in the configured ABAP version") === true) {
      // the function-group compile shape: the transpiler compiles a *.abap
      // include as a program, and "FUNCTION" is not in its dialect -- the
      // name of what to dump is the file's own
      const fugr = /^([^.]+)\.fugr\./.exec(file);
      if (fugr !== null) ask(nameFromAbapFile(fugr[1]), "fugr", finding);
      else unclassified.push(finding.raw);
    } else if (cascadeOf(message) !== undefined) {
      cascades++;
    } else {
      unclassified.push(finding.raw);
    }
  }
  return {names, cascades, unclassified};
}

// ----------------------------------------------------------- decision ----

/** the files whose stubs are held back this round because their definition
 *  findings are exclusion material: `unmatched` findings whose every name
 *  is settled (nothing this iteration's request can still bring -- fix
 *  round 2's strict predicate, the caller's `pendingOf`). Held files are
 *  decided in the quiescent round (exclusionDecisions); applying their
 *  method stubs would rewrite a file the decision is about to keep whole.
 *  Pure. */
export function exclusionCandidates({files, pendingOf}) {
  const held = new Set();
  for (const f of files ?? []) {
    if ((f.unmatched ?? []).length === 0) continue;
    if (classifyFindings(f.unmatched).names.some((n) => pendingOf(n.name, n.kind) === true) === false) {
      held.add(f.object);
    }
  }
  return held;
}

/** the exclusion decision for one quiescent stub round, over the whole
 *  island. `files` carries, per island file with findings, its `object`,
 *  its `file` path (root-relative, what the seam reads) and the
 *  definition-level findings (`unmatched`) the decision is made from. The
 *  answerability callbacks read the walk's state: `pendingOf` (the strict
 *  fixed-point predicate), `presentFile`, `missingOf`, `refusedOf`,
 *  `askedOf`, `resolvedOf`; `excludedObjects` is the decision's own set so
 *  far -- roots and re-evaluated cascades; `guard` is the seed service
 *  classes with `guardMode` saying how they were recognised
 *  ("registration" | "suffix"). Returns {blocked, records}: `blocked` when
 *  the gate found a pending name (nothing is decided this round),
 *  `records` the closure-stubs.json records -- definition roots, cascade
 *  records (excluded false: recorded only; true: excluded on
 *  re-evaluation) and cycles. Throws on a seed class that would be
 *  excluded. Pure. */
export function exclusionDecisions({files, pendingOf, presentFile, missingOf, refusedOf, askedOf, resolvedOf, excludedObjects, guard, guardMode}) {
  // the gate (fix round 2, item 1): every name of every DEFINITION-level
  // finding in the island must be settled before anything is excluded --
  // never decide on an incomplete island. The method-body findings are the
  // stub rounds' own material (their names go out eager or deferred in
  // this very iteration's request); gating on those would push every
  // exclusion past every request-writing iteration and starve the
  // request's `excluded` key. The bed's iteration-3 knot is a DEFINITION
  // finding naming a pending superclass -- this gate is what stops it.
  for (const f of files ?? []) {
    for (const n of classifyFindings(f.unmatched ?? []).names) {
      if (pendingOf(n.name, n.kind) === true) return {blocked: true, records: []};
    }
  }
  const perFile = (files ?? []).map((f) => {
    const unmatched = f.unmatched ?? [];
    return {...f, unmatched,
      names: classifyFindings(unmatched).names,
      nameless: unmatched.some((finding) => classifyFindings([finding]).names.length === 0)};
  });
  const byObject = new Map(perFile.filter((f) => f.unmatched.length > 0).map((f) => [f.object, f]));
  // a name's status for the decision: excluded by this decision, present
  // (red when its file has definition findings of its own, clean
  // otherwise -- a present-DDIC name has no own findings to look at), or
  // answered-absent (a missing answer, a merge refusal, asked and resolved
  // but still failing). Past the gate nothing is pending, so the rest --
  // the unreachable branch -- reads as answered-absent too: the gate
  // decided, and a mutation that drops it must still decide, not hang.
  const statusOf = (name, kind) => {
    if (excludedObjects.has(name) === true) return "excluded";
    if (presentFile(name, kind) === true) return byObject.has(name) === true ? "red" : "clean";
    return "absent";
  };
  // roots: files whose definition findings name an answered-absent thing
  // or name nothing at all -- excluded on their own account (item 3). A
  // finding naming an EXCLUDED object makes a cascade, never a root.
  const roots = new Set();
  for (const f of perFile) {
    if (f.unmatched.length === 0) continue;
    if (f.nameless === true || f.names.some((n) => statusOf(n.name, n.kind) === "absent") === true) {
      roots.add(f.object);
    }
  }
  // the chain bottoms of one file: the roots its cascades end at and the
  // objects this decision has already excluded; `self` says the file
  // reaches itself through present-but-red objects only -- a true cycle
  // member (item 4). Pure.
  const bottomsOf = (start) => {
    const rootBottoms = new Set();
    const excludedBottoms = new Set();
    let self = false;
    const seen = new Set([start.object]);
    const stack = [start];
    while (stack.length > 0) {
      const f = stack.pop();
      for (const n of f.names) {
        const status = statusOf(n.name, n.kind);
        if (status === "excluded") { excludedBottoms.add(n.name); continue; }
        if (status !== "red") continue; // clean is transient; absent is a root
        if (roots.has(n.name) === true) { rootBottoms.add(n.name); continue; }
        if (n.name === start.object) { self = true; continue; }
        if (seen.has(n.name) === true) continue;
        seen.add(n.name);
        stack.push(byObject.get(n.name));
      }
    }
    return {rootBottoms, excludedBottoms, self};
  };
  const guardThrow = (object, findings, why) => {
    const how = guardMode === "suffix"
      ? "recognised by suffix (no registration in gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml)"
      : "gen/hana-segw or the island's *.iwsv.xml / *.iwmo.xml";
    const error = new Error(`hana-closure: ${object} is a registered service's own class (${how}): ${why} -- the service itself cannot be excluded from the build, the run fails: ${findings.join(" | ")}`);
    error.guard = true;
    throw error;
  };
  const records = [];
  for (const object of [...roots].sort()) {
    const f = byObject.get(object);
    const findings = f.unmatched.map((x) => x.raw);
    if (guard.has(object) === true) guardThrow(object, findings, "its findings are definition-level");
    records.push({level: "definition", file: f.file, object, findings});
  }
  const cycleMembers = new Set();
  for (const f of perFile) {
    if (f.unmatched.length === 0 || roots.has(f.object) === true) continue;
    const {rootBottoms, excludedBottoms, self} = bottomsOf(f);
    if (rootBottoms.size === 0 && excludedBottoms.size === 0) {
      // no bottom: a true cycle member (kept, item 4), or a chain into one,
      // or findings that will clear on their own -- nothing to decide
      if (self === true) cycleMembers.add(f.object);
      continue;
    }
    const of = [...new Set([...rootBottoms, ...excludedBottoms])].sort();
    const excluded = excludedBottoms.size > 0;
    const findings = f.unmatched.map((x) => x.raw);
    if (guard.has(f.object) === true) {
      guardThrow(f.object, findings, `its findings are cascades of ${of.join(", ")}`);
    }
    records.push({level: "cascade", file: f.file, object: f.object, of, findings, excluded});
  }
  if (cycleMembers.size > 0) {
    const findings = {};
    for (const object of [...cycleMembers].sort()) {
      findings[object] = byObject.get(object).unmatched.map((x) => x.raw);
    }
    records.push({level: "cycle", members: [...cycleMembers].sort(), findings});
  }
  return {blocked: false, records};
}
