// How much of the corpus the front end that exists can actually read.
//
// Until the parser existed this could only be estimated: docs/sqlscript-corpus.md
// counted **constructs** and inferred a curve. This counts **bodies that go
// through whole**, which is the only number that predicts how much of the
// corpus runs -- a body needs all of its constructs at once, so a construct
// at 80% frequency buys nothing on its own.
//
// And it answers the question the frequency table could not: which construct
// to write next. Not the commonest one, but the one that is **the only thing
// missing** in the most bodies -- the cheapest unlock at this moment, which
// changes after every construct added.
//
//   node tools/sqlscript/coverage.mjs [.local/a4h-export] [--ddic <folder>]...
import {readFileSync, readdirSync, mkdirSync, rmSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename, join} from "node:path";
import {lex, LexError} from "./lexer.mjs";
import {parse, ParseError} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {lower, DIALECTS} from "../sqlscript-lower.mjs";

const DIALECT_NAMES = Object.keys(DIALECTS).sort();
import * as extractor from "../amdp-extract.mjs";
import {definitionsDisagree} from "../amdp-extract.mjs";
import {FolderDdic, RELEASED_DDIC, existingFolders} from "./folder-ddic.mjs";
import {parseTableFunction} from "./table-function-ddls.mjs";
import {typedParameters} from "./signature-schemas.mjs";
import {compileProcedure} from "../sqlscript-to-procedure-ir.mjs";
import {ddicCatalogue} from "../sqlscript-ddic-catalogue.mjs";
import {registryFromDdls, registryFromClass} from "./table-function-registry.mjs";
import {teachingPackages} from "./corpus-config.mjs";

/** the teaching packages, named in the gitignored .local/corpus-names.json (corpus content stays local) */
let teaching;
const isTeaching = (pkg) => (teaching ??= teachingPackages())(pkg);


/** the bodies of a class, each with the signature its method declares --
 *  because fifteen of the refusals were the signature and not the body --
 *  and each with the language it is written in, because not all of them are
 *  SQLScript and a denominator that does not say so is a lie by omission. */
export function bodiesOf(source, filename) {
  try {
    const {extract} = extractor;
    const cls = extract(source, filename);
    const methods = cls?.methods ?? [];
    if (methods.length > 0) {
      // the text reader is checked against abaplint wherever abaplint reads
      // the class, so where it is the only reader its trust is a number
      const check = definitionsDisagree(source, filename);
      return methods.map((m) => ({body: m.body, signature: m, types: cls.types, className: cls.className,
        signatureSource: m.signatureSource ?? cls.definitionSource, crossCheck: check, language: (m.language || "SQLSCRIPT").toUpperCase()}));
    }
  } catch {
    // a class the extractor cannot read still has bodies worth counting
  }
  const out = [];
  // a METHOD statement abaplint cannot parse (ANOMALY-2026-09-23-amdp-method-options)
  // is not a MethodImplementation, so its body is read here by text -- and
  // its signature too, from the definition, marked as read by text
  const textDefinitions = extractor.definitionsByText(source);
  const className = filename.replace(/\.clas\.abap$/i, "").toUpperCase();
  const re = /METHOD\s+([\w~]+)\s+BY\s+DATABASE\s+(?:PROCEDURE|FUNCTION|GRAPH\s+WORKSPACE)\b([\s\S]*?)\.\s*([\s\S]*?)ENDMETHOD\s*\./gi;
  for (const m of source.matchAll(re)) {
    const name = m[1];
    const params = textDefinitions.get(name.toUpperCase());
    const usings = (/\bUSING\b([^.]*)/i.exec(m[2])?.[1] ?? "").split(/[\s,]+/).filter(Boolean);
    out.push({
      body: m[3],
      signature: params === undefined ? undefined : {name, parameters: params, usings, dbKind: /FUNCTION/i.test(m[0].slice(0, 80)) ? "FUNCTION" : "PROCEDURE", signatureSource: "text"},
      signatureSource: "text",
      className,
      language: (/LANGUAGE\s+(\w+)/i.exec(m[2])?.[1] ?? "SQLSCRIPT").toUpperCase(),
    });
  }
  return out;
}

export function classesIn(zip, dir) {
  // a scratch folder from an earlier, different export must not leak its
  // dictionary into this run
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".clas.abap")) found.push(join(d, e.name));
    }
  };
  walk(dir);
  return found;
}

/**
 * A database method whose class declares no parameters for it gets them
 * from where they are declared, in place: a redefinition from
 * the superclass up the INHERITING FROM chain, `METHOD if_x~m` from the
 * interface -- read from the export's own sources (a body whose ancestor is
 * not in the export keeps none). The ancestor's types come along, the
 * class's own winning a name they share. Answers how many were filled.
 */
export function inheritedSignatures(bodies, classSources, interfaceSources) {
  let read = 0;
  for (const one of bodies) {
    if (one.signature === undefined || (one.signature.parameters ?? []).length > 0) continue;
    const own = classSources.get(String(one.className).toUpperCase());
    if (own === undefined) continue;
    const name = String(one.signature.name).toUpperCase();
    // `METHOD if_x~m BY DATABASE ...`: the signature is the interface's
    if (name.includes("~")) {
      const [intf, method] = name.split("~");
      const source = interfaceSources.get(intf);
      const params = source === undefined ? undefined : extractor.definitionsByText(source).get(method);
      if (params !== undefined && params.length > 0) {
        one.signature = {...one.signature, parameters: params, signatureSource: "interface"};
        const types = new Map(extractor.localTypes(source));
        for (const [k, v] of one.types ?? []) types.set(k, v);
        one.types = types;
        read += 1;
      }
      continue;
    }
    // no parameters and a superclass: walk up. Not gated on the text
    // `METHODS m REDEFINITION` -- `FINAL REDEFINITION` and a `METHODS:` chain
    // spell it otherwise, and a method without parameters of its own that the
    // superclass also declares can only be a redefinition. ALIASES are not
    // followed.
    let source = own;
    const inherited = new Map();
    for (let depth = 0; depth < 8; depth++) {
      const parent = /INHERITING\s+FROM\s+([\w\/]+)/i.exec(source)?.[1]?.toUpperCase();
      source = parent === undefined ? undefined : classSources.get(parent);
      if (source === undefined) break;
      for (const [k, v] of extractor.localTypes(source)) if (!inherited.has(k)) inherited.set(k, v);
      const params = extractor.definitionsByText(source).get(name);
      if (params !== undefined && params.length > 0) {
        one.signature = {...one.signature, parameters: params, signatureSource: "superclass"};
        const types = new Map(inherited);
        for (const [k, v] of one.types ?? []) types.set(k, v);
        one.types = types;
        read += 1;
        break;
      }
    }
  }
  return read;
}

/** what stopped this body, in a form that can be counted */
export function reasonOf(error, tokens) {
  if (error instanceof LexError) return `lex: ${error.message.replace(/: line.*/, "")}`;
  if (!(error instanceof ParseError)) return `internal: ${error.message.slice(0, 40)}`;
  // the token it stopped at is the useful thing: it names the construct the
  // grammar does not have yet
  const at = tokens.find((t) => t.line === error.line && t.col === error.col);
  const word = String(at?.value ?? "end of body").toUpperCase();
  return `parse: at ${word}`;
}

export function measure(root = ".local/a4h-export", scratch = "/tmp/sqlscript-coverage", options = {}) {
  const zips = readdirSync(root).filter((f) => f.endsWith(".zip")).sort();
  const corpora = {teaching: [], working: []};
  // The dictionary the scalar typer resolves data elements against: the
  // packages' own DTEL/DOMA (an export carries them beside the classes),
  // then whatever `--ddic` names, then the released dump if it is cloned.
  // A parameter typed by an element none of them holds is a **named**
  // refusal below, not "unknown scalar" -- and not STRING.
  // Later folder wins, as in `abap_transpile.json`: the released dump is
  // the oldest and most general, `--ddic` more specific, and a package's own
  // export -- taken off the system that runs it -- the most specific of all.
  const ddic = new FolderDdic(existingFolders([RELEASED_DDIC, ...(options.ddic ?? [])]));
  // every class of the export by name, for a REDEFINITION's signature
  const classSources = new Map();
  const interfaceSources = new Map();
  for (const zip of zips) {
    const pkg = zip.replace(/\.zip$/, "");
    const which = isTeaching(pkg) ? "teaching" : "working";
    for (const file of classesIn(join(root, zip), join(scratch, pkg))) {
      const source = readFileSync(file, "utf8");
      classSources.set(file.split("/").pop().replace(/\.clas\.abap$/i, "").toUpperCase(), source);
      for (const one of bodiesOf(source, file.split("/").pop())) corpora[which].push({...one, pkg});
    }
    // the interfaces of the package, for an `IF_X~m` implementation's signature
    const walkIntf = (d) => {
      for (const e of readdirSync(d, {withFileTypes: true}).sort((x, y) => x.name.localeCompare(y.name))) {
        if (e.isDirectory()) walkIntf(join(d, e.name));
        else if (e.name.endsWith(".intf.abap")) interfaceSources.set(e.name.replace(/\.intf\.abap$/i, "").toUpperCase(), readFileSync(join(d, e.name), "utf8"));
      }
    };
    walkIntf(join(scratch, pkg));
    ddic.add(join(scratch, pkg));
  }
  const resolveType = ddic.resolver();
  // A method declared FOR TABLE FUNCTION has its parameters in the DDLS.
  // Read them once every package is indexed: the DDLS is usually in the
  // same package as its class, but nothing says it must be.
  let tableFunctionsRead = 0;
  const tableFunctionsMissing = new Map();
  for (const one of [...corpora.teaching, ...corpora.working]) {
    const name = one.signature?.tableFunction;
    if (name === undefined) continue;
    const ddls = ddic.read("DDLS", name);
    if (ddls === undefined) {
      const key = `${name} (not in the export)`;
      tableFunctionsMissing.set(key, (tableFunctionsMissing.get(key) ?? 0) + 1);
      continue;
    }
    let tf;
    try {
      tf = parseTableFunction(ddls.source);
    } catch (error) {
      const key = `${name} (${String(error.message).slice(0, 40)})`;
      tableFunctionsMissing.set(key, (tableFunctionsMissing.get(key) ?? 0) + 1);
      continue;
    }
    if (tf === undefined) {
      // the DDLS of that name is a view, not a table function
      const key = `${name} (not a table function)`;
      tableFunctionsMissing.set(key, (tableFunctionsMissing.get(key) ?? 0) + 1);
      continue;
    }
    one.signature = {...one.signature, parameters: tf.parameters, returns: tf.returns};
    tableFunctionsRead += 1;
  }

  const redefinitionsRead = inheritedSignatures([...corpora.teaching, ...corpora.working], classSources, interfaceSources);


  // **The catalogue, closed over the dictionary.** Three things a body reads
  // that the instrument used to describe with nothing: the tables its USING
  // names (resolved through the exports' own TABL, the way amdp-gen does it
  // through the tree's), its table parameters (a local TYPES of the class
  // or a TTYP of the dictionary), and, through both, every data element
  // and include. A table that cannot be resolved is left out and named, so
  // the body's refusal stays "the catalogue does not describe X" and the
  // header says why.
  // **The table functions a body may call**, from both places they are
  // declared: every DDLS table function the dictionary holds, and every
  // `BY DATABASE FUNCTION` method with a RETURNING table type in the
  // classes read. Keyed as a body spells the callee (`CL=>M`, DDLS name).
  const fromDdls = registryFromDdls(ddic, resolveType);
  const tableFunctions = {...fromDdls.registry};
  const registrySkipped = [...fromDdls.unreadable];
  const byClass = new Map();
  for (const one of [...corpora.teaching, ...corpora.working]) {
    if (one.className === undefined || one.signature === undefined) continue;
    if (!byClass.has(one.className)) byClass.set(one.className, {types: one.types, methods: []});
    byClass.get(one.className).methods.push(one.signature);
  }
  for (const [className, {types, methods}] of byClass) {
    const got = registryFromClass(className, methods, {types, store: ddic, resolve: resolveType});
    Object.assign(tableFunctions, got.registry);
    registrySkipped.push(...got.skipped);
  }
  // the cross-check, once per class
  const crossCheck = {classes: 0, methodsCompared: 0, differing: []};
  const checkedClasses = new Set();
  let classesByText = 0;
  for (const one of [...corpora.teaching, ...corpora.working]) {
    if (one.className === undefined || checkedClasses.has(one.className)) continue;
    checkedClasses.add(one.className);
    if (one.signatureSource === "text") classesByText += 1;
    if (one.crossCheck === undefined || one.crossCheck.compared === 0) continue;
    crossCheck.classes += 1;
    crossCheck.methodsCompared += one.crossCheck.compared;
    for (const d of one.crossCheck.differing) crossCheck.differing.push(`${one.className}=>${d.method}: abaplint [${d.abaplint}] text [${d.text}]`);
  }
  const usingFailures = new Map();
  const parameterFailures = new Map();
  for (const one of [...corpora.teaching, ...corpora.working]) {
    const catalogue = {};
    for (const name of one.signature?.usings ?? []) {
      const table = String(name).toUpperCase();
      if (ddic.find("TABL", table) === undefined) continue;
      try {
        Object.assign(catalogue, ddicCatalogue(ddic, [table]));
      } catch (error) {
        const key = `${table}: ${String(error.message).slice(0, 70)}`;
        usingFailures.set(key, (usingFailures.get(key) ?? 0) + 1);
      }
    }
    const {parameters, untyped} = typedParameters(one.signature, {types: one.types, store: ddic, resolve: resolveType});
    for (const [name, reason] of Object.entries(untyped)) {
      const key = `${name}: ${reason.slice(0, 70)}`;
      parameterFailures.set(key, (parameterFailures.get(key) ?? 0) + 1);
    }
    const relationSchemas = {};
    for (const p of parameters) {
      if (p.kind === "table") {
        catalogue[String(p.name).toUpperCase()] = p.schema;
        relationSchemas[String(p.name).toUpperCase()] = p.schema;
      }
    }
    one.signature = {...one.signature, parameters};
    one.catalogue = catalogue;
    one.relationSchemas = relationSchemas;
    // the USING tables no dictionary here holds at all: what an export
    // from the system would have to bring, ranked below by what it unlocks
    one.absentUsings = (one.signature?.usings ?? [])
      .map((name) => String(name).toUpperCase())
      .filter((name) => !name.includes("=>") && !name.includes(".") && !name.startsWith("M_")
        && ddic.find("TABL", name) === undefined && ddic.find("DDLS", name) === undefined);
  }

  const report = {};
  for (const [which, all] of Object.entries(corpora)) {
    // **What the denominator was counted with** (fable-osd asked for this line
    // and the corpus then showed why it is not a formality). `BY DATABASE
    // PROCEDURE` does not mean SQLScript: the same syntax carries LANGUAGE
    // GRAPH, LANGUAGE SQL and LANGUAGE LLANG, and the GRAPH bodies are a
    // different language outright -- C-style `{ }` blocks, `==`, `N''`
    // literals. They were sitting in the denominator and, worse, at the TOP
    // of the blocker histogram, where "at =" read as though SQLScript
    // equality were unimplemented. It is not; those bodies are not SQLScript.
    // A front end for SQLScript is measured against the SQLScript bodies, and
    // the rest are named rather than silently dropped.
    const byLanguage = new Map();
    for (const one of all) byLanguage.set(one.language, (byLanguage.get(one.language) ?? 0) + 1);
    const bodies = all.filter((one) => one.language === "SQLSCRIPT");
    // Three numbers, not one (fable-osd). "Parses" is not "runs": stage 3
    // refuses Declare, Return and Block by name, so a body can go through
    // the grammar whole and still never reach an engine. One number called
    // "coverage" would be quoted a week later as "8% of the corpus works",
    // and we would be the ones quoting it -- the name of a metric being
    // wider than what it measures is the defect this project keeps paying
    // for. Only the third number is showable.
    const reasons = new Map();
    const afterParse = new Map();
    let parsed = 0;
    let loweredCount = 0;
    let loweredHana = 0;
    let loweredStrict = 0;
    const strictOnly = new Map();
    const wanted = new Map();
    let wantsSeveral = 0;
    const wantedByPackage = new Map();
    // the runtime's own compiler, beside the relational binder: a body with
    // CALL, IF or DECLARE can only ever count here, and its refusals say
    // what the runtime would refuse (measurement only)
    let compiled = 0;
    const compileRefusals = new Map();
    let loweredByText = 0;
    let strictByText = 0;
    const strictByDialect = Object.fromEntries(DIALECT_NAMES.map((one) => [one, 0]));
    let strictEverywhere = 0;
    for (const {body, signature, catalogue, relationSchemas, absentUsings, pkg, signatureSource, types} of bodies) {
      if (signature !== undefined) {
        try {
          compileProcedure({...signature, body}, types ?? new Map(), {catalogue, resolveType, store: ddic});
          compiled += 1;
        } catch (error) {
          const why = String(error.message ?? error).replace(/: line.*/, "").slice(0, 70);
          compileRefusals.set(why, (compileRefusals.get(why) ?? 0) + 1);
        }
      }
      let tokens = [];
      let tree;
      try {
        tokens = lex(body);
        tree = parse(new Body(), tokens);
        parsed += 1;
      } catch (error) {
        const reason = reasonOf(error, tokens);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      // Lowered is counted **per dialect**: a body whose FROM names a HANA
      // procedure lowers on hana by printing the name and on duckdb not at
      // all, and one number for both would call a HANA passthrough progress
      // (foreman-dell). The headline is the portable one.
      let ir;
      try {
        ir = toIr(tree, {catalogue, signature, resolveType, relationSchemas, tableFunctions});
        lower(ir.rel, "duckdb");
        loweredCount += 1;
        if (signatureSource === "text") loweredByText += 1;
      } catch (error) {
        const why = String(error.message ?? error).replace(/: line.*/, "").slice(0, 60);
        afterParse.set(why, (afterParse.get(why) ?? 0) + 1);
      }
      if (ir !== undefined) {
        try {
          lower(ir.rel, "hana");
          loweredHana += 1;
        } catch {
          // counted by its absence from the hana column; the duckdb reason above names it
        }
        // and how many lower only because a column nobody described became
        // STRING: the same body bound with every column required to be typed
        try {
          const strictRel = toIr(tree, {catalogue, signature, resolveType, relationSchemas, tableFunctions, strictColumns: true}).rel;
          lower(strictRel, "duckdb");
          loweredStrict += 1;
          if (signatureSource === "text") strictByText += 1;
          // portable means one answer on every database we support, so the
          // strict count is also taken per dialect and for all of them at once
          let everywhere = true;
          for (const dialect of DIALECT_NAMES) {
            try {
              lower(strictRel, dialect);
              strictByDialect[dialect] += 1;
            } catch {
              everywhere = false;
            }
          }
          if (everywhere) strictEverywhere += 1;
        } catch (error) {
          const why = String(error.message ?? error).replace(/: line.*/, "").slice(0, 60);
          strictOnly.set(why, (strictOnly.get(why) ?? 0) + 1);
          // a body that lowers only by guessing: which absent tables would
          // let it be typed. Counted per table, so an export can be asked
          // for by name and by what it buys; a body needing two or more is
          // flagged, because one table alone moves nothing for it.
          for (const table of absentUsings ?? []) wanted.set(table, (wanted.get(table) ?? 0) + 1);
          if ((absentUsings ?? []).length >= 2) wantsSeveral += 1;
          if ((absentUsings ?? []).length > 0) {
            // and by package, because an export is asked for per package and
            // eight tables for eight bodies of one package is one decision
            const entry = wantedByPackage.get(pkg) ?? {bodies: 0, tables: new Set()};
            entry.bodies += 1;
            for (const table of absentUsings) entry.tables.add(table);
            wantedByPackage.set(pkg, entry);
          }
        }
      }
    }
    report[which] = {
      counted: all.length,
      byLanguage: [...byLanguage.entries()].sort((a, b) => b[1] - a[1]),
      bodies: bodies.length,
      parsed,
      lowered: loweredCount,
      loweredHana,
      loweredStrict,
      loweredByText,
      strictByText,
      strictByDialect,
      strictEverywhere,
      compiled,
      compileRefusals: [...compileRefusals.entries()].sort((a, b) => b[1] - a[1]),
      strictRefusals: [...strictOnly.entries()].sort((a, b) => b[1] - a[1]),
      wanted: [...wanted.entries()].sort((a, b) => b[1] - a[1]),
      wantsSeveral,
      wantedByPackage: [...wantedByPackage.entries()].map(([name, e]) => [name, e.bodies, e.tables.size]).sort((a, b) => b[1] - a[1]),
      share: bodies.length === 0 ? 0 : Math.round((loweredCount / bodies.length) * 100),
      shareStrict: bodies.length === 0 ? 0 : Math.round((loweredStrict / bodies.length) * 100),
      stoppedBy: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      parsedButNotLowered: [...afterParse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }
  report.dictionary = ddic;
  report.bodies = corpora;
  report.catalogueFailures = {using: [...usingFailures.keys()], parameters: [...parameterFailures.keys()]};
  // distinct declarations, not keys: a DDLS with `implemented by method` is keyed twice
  report.registry = {size: new Set(Object.values(tableFunctions)).size, ddls: new Set(Object.values(fromDdls.registry)).size, skipped: registrySkipped};
  report.signatures = {classesByText, crossCheck};
  report.scratch = scratch;
  report.redefinitions = {read: redefinitionsRead};
  // the registry itself, for a caller that compiles the bodies again (the
  // corpus oracle): `tableFunctions` above is the count, not the map
  report.tableFunctionRegistry = tableFunctions;
  report.tableFunctions = {read: tableFunctionsRead, missing: [...tableFunctionsMissing.entries()].map(([k, n]) => (n > 1 ? `${k} x${n}` : k))};
  return report;
}

// The check is the **file name**, not a suffix of it. A suffix matched more
// than it meant: fable-osd's `sqlscript-force-coverage.mjs` imported this
// module and this line ran her command line as ours, because her name also
// ends in "coverage.mjs". Same family as everything else caught today -- a
// test that is wider than the thing it has in mind.
if (basename(process.argv[1] ?? "") === "coverage.mjs") {
  // coverage.mjs [root] [--ddic <folder>]...   the folders hold *.dtel.xml / *.doma.xml
  const args = process.argv.slice(2);
  const ddic = [];
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--ddic") ddic.push(args[++i]);
    else rest.push(args[i]);
  }
  const {dictionary, tableFunctions, tableFunctionRegistry: _registry, scratch, catalogueFailures, registry, signatures, bodies: _bodies, ...corporaReport} = measure(rest[0], undefined, {ddic});
  // the numbers below depend on which dictionaries this machine holds, so
  // the header says which, and how much each one answered
  console.log("dictionaries given to the scalar typer (later wins a shared name):");
  const exports = dictionary.folders.filter((f) => f.startsWith(scratch));
  for (const line of dictionary.describe()) {
    if (!exports.includes(line.split("  (")[0])) console.log(`  ${line}`);
  }
  console.log(`  ${exports.length} package exports  (${exports.reduce((n, f) => n + (dictionary.hits.get(f) ?? 0), 0)} resolved)`);
  console.log(`table-function signatures read off their DDLS: ${tableFunctions.read}` +
    (tableFunctions.missing.length === 0 ? "" : `; not usable: ${tableFunctions.missing.join(", ")}`));
  console.log(`table functions a body may call: ${registry.size} declarations (${registry.ddls} DDLS, the rest AMDP functions of the classes read)` +
    (registry.skipped.length === 0 ? "" : `; ${registry.skipped.length} not registered, e.g. ${registry.skipped.slice(0, 3).join("; ")}`));
  console.log(`signatures: ${signatures.classesByText} classes read as text because abaplint gave no definition (ANOMALY-2026-09-23-amdp-method-options); ` +
    `text reader cross-checked against abaplint on ${signatures.crossCheck.classes} classes / ${signatures.crossCheck.methodsCompared} methods: ${signatures.crossCheck.differing.length} differ` +
    (signatures.crossCheck.differing.length === 0 ? "" : `\n  ${signatures.crossCheck.differing.slice(0, 6).join("\n  ")}`));
  if (catalogueFailures.using.length > 0) console.log(`USING tables in the export refused whole (an include did not resolve): ${catalogueFailures.using.length}\n  ${catalogueFailures.using.slice(0, 8).join("\n  ")}`);
  if (catalogueFailures.parameters.length > 0) console.log(`table parameters not typed: ${catalogueFailures.parameters.length}\n  ${catalogueFailures.parameters.slice(0, 8).join("\n  ")}`);
  for (const [which, r] of Object.entries(corporaReport)) {
    console.log(`\n${which}: ${r.bodies} SQLScript bodies` +
      ` (of ${r.counted} BY DATABASE bodies: ${r.byLanguage.map(([l, n]) => `${l} ${n}`).join(", ")})`);
    console.log(`  parsed   ${r.parsed}`);
    // quoted first: what the runtime's own compiler accepts. The binder's
    // numbers below say what lowers to SQL, which is not yet what runs.
    console.log(`  compiles as a procedure  ${r.compiled}  (${Math.round((r.compiled / Math.max(1, r.bodies)) * 100)}% -- the runtime's compiler: the number to quote)`);
    for (const [reason, count] of r.compileRefusals.slice(0, 8)) console.log(`  ${String(count).padStart(5)}  procedure: ${reason}`);
    console.log(`  lowered  ${r.loweredStrict}  (${r.shareStrict}% -- the relational binder on duckdb, every column typed; lowers, not yet runs)`);
    console.log(`           ${r.strictEverywhere} of them lower on every dialect (${DIALECT_NAMES.join(", ")}); per dialect: ${DIALECT_NAMES.map((one) => `${one} ${r.strictByDialect[one]}`).join(", ")}`);
    console.log(`           ${r.lowered} when a column nobody described may be STRING (${r.share}%), ${r.loweredHana} of those on hana`);
    if (r.strictByText > 0 || r.loweredByText > 0) console.log(`           of which on a signature read as text: ${r.strictByText} strict, ${r.loweredByText} lowered`);
    for (const [reason, count] of r.strictRefusals.slice(0, 6)) console.log(`  ${String(count).padStart(5)}  strict: ${reason}`);
    if (r.wanted.length > 0) {
      console.log(`  wanted: tables in no dictionary here, by the bodies that lower only by guessing and name them (${r.wantsSeveral} of those need two or more):`);
      console.log(`    ${r.wanted.slice(0, 15).map(([table, n]) => `${table} ${n}`).join(", ")}`);
      console.log(`    by package (bodies / tables to export): ${r.wantedByPackage.slice(0, 8).map(([name, b, t]) => `${name} ${b}/${t}`).join(", ")}`);
    }
    console.log("  stopped in the grammar:");
    for (const [reason, count] of r.stoppedBy) {
      console.log(`  ${String(count).padStart(5)}  ${reason}`);
    }
    if (r.parsedButNotLowered.length > 0) {
      console.log("  parsed and then refused by the lowering:");
      for (const [reason, count] of r.parsedButNotLowered) {
        console.log(`  ${String(count).padStart(5)}  ${reason}`);
      }
    }
  }
  console.log("\nA body needs all of its constructs at once, so the next construct to write");
  console.log("is the one at the top of the working list -- not the commonest one.");
  process.exit(0);
}
