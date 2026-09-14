// The test run of OSD: ABAP Unit for one object, shaped the way ADT
// reports it.
//
// A client does not ask "did it pass". It asks for a program, its test
// classes, their test methods, and for each method the alerts, which is
// where the human-readable failure lives. So this returns exactly that
// tree, and the façade renders it as
//
//   runResult > program > testClasses > testClass > testMethods >
//   testMethod > alerts > alert > title, details/detail, stack/stackEntry
//
// The names and attributes are vsp's, taken from what its client actually
// unmarshals, not from a memory of ADT: a method with no alert passed, a
// method with one did not, and severity and kind separate a failed
// assertion from an exception or a dump.
//
// What runs the tests is the transpiled runtime, the same modules the
// gateway serves from. Which classes and methods exist comes from the
// parse, not from the generated index, so a test that was written and not
// yet transpiled is reported as such instead of silently missing.
import {existsSync, readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {basename, join} from "node:path";
import {resolveFrame} from "./osd-where.mjs";
export {statementAfter} from "./osd-where.mjs";
import {ObjectStore, NotFound} from "./osd-store.mjs";

// ADT's own words for what a class declares
const RISK = {HARMLESS: "harmless", DANGEROUS: "dangerous", CRITICAL: "critical"};
const DURATION = {SHORT: "short", MEDIUM: "medium", LONG: "long"};

// what the program element calls the object
const ADT_TYPE = {CLAS: "CLAS/OC", INTF: "INTF/OI", PROG: "PROG/P", FUGR: "FUGR/F"};

export class UnitRun {
  constructor(store = new ObjectStore()) {
    this.store = store;
  }

  // the test classes of an object, from the parse: what would run, without
  // running it. The façade uses this for a testruns request that only asks
  // what tests there are.
  classes(type, name) {
    const entry = this.store.find(type, name);
    if (entry === undefined) {
      throw new NotFound(type, name);
    }
    const object = this.store.registry().getObject(type, entry.name);
    if (object === undefined || object.getABAPFiles === undefined) {
      return {object: entry, classes: []};
    }
    const classes = [];
    for (const file of object.getABAPFiles()) {
      const filename = file.getFilename();
      const implementations = new Map(file.getInfo().listClassImplementations().map((i) => [i.name.toUpperCase(), i]));
      for (const definition of file.getInfo().listClassDefinitions()) {
        if (definition.isForTesting !== true || definition.isAbstract === true) {
          continue;
        }
        // a method's position is where its body is, not where it was
        // declared: a client that follows the URI wants the code
        const bodies = new Map((implementations.get(definition.name.toUpperCase())?.methods ?? [])
          .map((m) => [m.token.strUpper, m.token.start]));
        const methods = definition.methods.filter((m) => m.isForTesting === true).map((m) => {
          const at = bodies.get(m.name.toUpperCase()) ?? m.identifier?.token?.start;
          return {
            name: m.name.toUpperCase(),
            method: m.name,
            line: at?.getRow?.() ?? at?.row ?? 1,
            column: at?.getCol?.() ?? at?.col ?? 1,
          };
        });
        classes.push({
          name: definition.name.toUpperCase(),
          localClass: definition.name,
          riskLevel: RISK[definition.riskLevel] ?? "harmless",
          durationCategory: DURATION[definition.duration] ?? "short",
          include: includeOf(filename),
          source: filename,
          module: basename(filename).replace(/\.abap$/, ".mjs"),
          line: definition.identifier?.token?.start?.row ?? 1,
          column: definition.identifier?.token?.start?.col ?? 1,
          testMethods: methods,
        });
      }
    }
    return {object: entry, classes};
  }

  // the run itself, in this process. Every method is timed and every throw
  // is caught, because one failure must not hide the methods after it: ADT
  // reports the whole tree, not the first thing that went wrong.
  async run(type, name, options = {}) {
    const started = Date.now();
    // a detached run is handed the plan the parent already parsed, because
    // parsing the system again in the child costs seconds and answers the
    // same
    const {object, classes} = options.plan ?? this.classes(type, name);
    const wanted = (c) => options.testClass === undefined || c.name === String(options.testClass).toUpperCase();
    const wantedMethod = (m) => options.method === undefined || m.name === String(options.method).toUpperCase();

    const program = {
      name: object.name,
      type: ADT_TYPE[object.type] ?? object.type,
      objectType: object.type,
    };
    const output = join(this.store.root, "output");
    if (existsSync(join(output, "init.mjs")) === false) {
      throw new NotTranspiled();
    }
    // the runtime and its database: in this process it is the one the
    // caller already booted, which is why the façade runs a test in a
    // child rather than over its own live data (see runDetached)
    await this.store.data().boot();

    const testClasses = [];
    for (const declared of classes.filter(wanted)) {
      const testClass = {...declared, testMethods: [], alerts: []};
      delete testClass.module;
      const file = join(output, declared.module);
      if (existsSync(file) === false) {
        testClass.alerts.push({
          kind: "exception",
          severity: "fatal",
          title: `${declared.name} has not been transpiled: ${declared.module} is not in output/`,
          details: ["Activate the object, or run the transpile, and ask again."],
          stack: [],
        });
        testClasses.push(testClass);
        continue;
      }
      let local;
      try {
        const module = await import(specifier(file));
        local = module[declared.localClass];
        if (local === undefined) {
          throw new Error(`${declared.localClass} is not exported by ${declared.module}`);
        }
        if (local.class_setup) {
          await local.class_setup();
        }
      } catch (error) {
        testClass.alerts.push(this.#alert(error, "class_setup"));
        testClasses.push(testClass);
        continue;
      }

      for (const method of declared.testMethods.filter(wantedMethod)) {
        testClass.testMethods.push(await this.#method(local, method, options));
      }

      try {
        if (local.class_teardown) {
          await local.class_teardown();
        }
      } catch (error) {
        testClass.alerts.push(this.#alert(error, "class_teardown"));
      }
      testClasses.push(testClass);
    }

    const methods = testClasses.flatMap((c) => c.testMethods);
    const failed = methods.filter((m) => m.alerts.length > 0).length;
    return {
      program,
      testClasses,
      counts: {
        classes: testClasses.length,
        methods: methods.length,
        passed: methods.length - failed,
        failed,
        classAlerts: testClasses.reduce((n, c) => n + c.alerts.length, 0),
      },
      ok: failed === 0 && testClasses.every((c) => c.alerts.length === 0),
      ms: Date.now() - started,
    };
  }

  // one method: setup, the method, teardown, each of them able to fail on
  // its own. The instance is new every time, the way ABAP Unit does it.
  async #method(local, declared, options) {
    const started = Date.now();
    const alerts = [];
    let test;
    try {
      test = await (new local()).constructor_();
      await call(test, "setup");
    } catch (error) {
      alerts.push(this.#alert(error, "setup"));
    }
    if (alerts.length === 0) {
      try {
        const run = test.FRIENDS_ACCESS_INSTANCE[declared.method]();
        await (options.timeout === 0 ? run : deadline(run, options.timeout ?? 60000, declared.name));
      } catch (error) {
        alerts.push(this.#alert(error, declared.method));
      }
      try {
        await call(test, "teardown");
      } catch (error) {
        alerts.push(this.#alert(error, "teardown"));
      }
    }
    const ms = Date.now() - started;
    return {
      name: declared.name,
      type: "TEST/M",
      executionTime: (ms / 1000).toFixed(3),
      unit: "s",
      ms,
      line: declared.line,
      column: declared.column,
      alerts,
    };
  }

  // a thrown thing becomes an alert, with the stack read back through the
  // source maps first
  #alert(error, where) {
    return alertOf(error, where, this.#stack(error));
  }

  // the JS stack, back through the source maps, so an entry names the ABAP
  // file and line rather than the module the transpiler wrote. Only the
  // transpiled modules are kept: the frames of this runner are ours, not
  // the developer's, and a client would only have to scroll past them.
  #stack(error) {
    const out = [];
    const output = join(this.store.root, "output");
    for (const line of String(error?.stack ?? "").split("\n").slice(1, 20)) {
      const at = /\((?:file:\/\/)?([^()]+\.mjs):(\d+):(\d+)\)/.exec(line) ?? /at (?:async )?(?:file:\/\/)?([^ ()]+\.mjs):(\d+):(\d+)/.exec(line);
      if (at === null) {
        continue;
      }
      const [, file, row, column] = at;
      if (decodeURIComponent(file).startsWith(output) === false) {
        continue;
      }
      const mapped = this.#map(file, Number(row), Number(column));
      const entry = mapped ?? {name: `${basename(file)}, line ${row}`, uri: basename(file), line: Number(row)};
      // the same line twice, once from where it was raised and once from
      // the frame that raised it, reads as noise
      if (out.at(-1)?.name !== entry.name) {
        out.push(entry);
      }
    }
    return out;
  }

  // the mapping itself lives in osd-where.mjs, which is the only copy: two
  // copies of a thing whose whole job is to be accurate is how they stop
  // agreeing. Only the shape the facade wants is built here.
  #map(file, row, column) {
    const found = resolveFrame(file, row, column);
    if (found === undefined) {
      return undefined;
    }
    return {name: `${found.file}, line ${found.line}`, uri: found.file, line: found.line, column: found.column};
  }

  // the run the façade wants: a child process, because a test writes to the
  // database and the server's own rows must not be what it writes to. The
  // child boots its own runtime, about a second, against its own in-memory
  // database, and prints the same object as JSON.
  runDetached(type, name, options = {}) {
    const plan = options.plan ?? this.classes(type, name);
    return new Promise((resolve, reject) => {
      const args = [new URL(import.meta.url).pathname, type, name, "--json", "--plan-stdin"];
      if (options.testClass !== undefined) {
        args.push("--class", options.testClass);
      }
      if (options.method !== undefined) {
        args.push("--method", options.method);
      }
      const child = spawn(process.execPath, args, {cwd: this.store.root, stdio: ["pipe", "pipe", "pipe"]});
      child.stdin.end(JSON.stringify(plan));
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => {
        out += d.toString();
      });
      child.stderr.on("data", (d) => {
        err += d.toString();
      });
      child.on("close", (code) => {
        const start = out.indexOf("{");
        if (start < 0) {
          reject(new RunFailed(code, `${out}${err}`.slice(-2000)));
          return;
        }
        try {
          resolve(JSON.parse(out.slice(start)));
        } catch (error) {
          reject(new RunFailed(code, `${error.message}: ${`${out}${err}`.slice(-2000)}`));
        }
      });
    });
  }
}

// A thrown thing becomes an alert. Three kinds, because a client shows them
// differently: an assertion that did not hold, an ABAP exception that
// nobody caught, and a failure of the runtime itself. Exported because the
// mapping is the interesting half and it can be checked without a runtime.
export function alertOf(error, where, stack = []) {
  const text = (value) => {
    const out = value?.get?.();
    return typeof out === "string" ? out.trimEnd() : undefined;
  };
  const details = [];
  // where the runtime says it was raised, unless the mapped stack already
  // starts there
  const raised = error?.EXTRA_CX;
  if (raised?.INTERNAL_FILENAME !== undefined) {
    const first = {name: `${raised.INTERNAL_FILENAME}, line ${raised.INTERNAL_LINE}`, uri: raised.INTERNAL_FILENAME, line: raised.INTERNAL_LINE};
    stack = stack[0]?.name === first.name ? stack : [first, ...stack];
  }

  const className = error?.constructor?.name;
  if (className === "kernel_cx_assert") {
    const expected = text(error.expected);
    const actual = text(error.actual);
    if (expected !== undefined && expected !== "") {
      details.push(`Expected [${expected}]`);
    }
    if (actual !== undefined && actual !== "") {
      details.push(`Actual [${actual}]`);
    }
    details.push(`Raised in ${where}`);
    return {kind: "failedAssertion", severity: "critical", title: text(error.msg) ?? "Unit test assertion failed", details, stack};
  }

  // an ABAP exception: the transpiled class is the name a developer knows
  if (error?.INTERNAL_ID !== undefined || typeof error?.get_text === "function") {
    const message = text(error.msg) ?? text(error.textid) ?? undefined;
    if (message !== undefined) {
      details.push(message);
    }
    details.push(`Raised in ${where}`);
    return {kind: "exception", severity: "critical", title: `Exception ${(className ?? "unknown").toUpperCase()} was not caught`, details, stack};
  }

  details.push(`Raised in ${where}`);
  return {kind: "shortDump", severity: "fatal", title: String(error?.message ?? error), details, stack};
}

// Where a failure really is.
//
// The transpiler maps a generated line to the position where the previous
// ABAP statement ended, so a stack entry read straight out of the map

// setup and teardown live in three places: the class, the friends instance
// the transpiler wraps it in, and the superclass of that
async function call(test, what) {
  if (test[what]) {
    await test[what]();
  }
  const friends = test.FRIENDS_ACCESS_INSTANCE;
  if (friends?.[what]) {
    await friends[what]();
  }
  if (friends?.SUPER?.[what]) {
    await friends.SUPER[what]();
  }
}

// a test that never returns must not take the request with it
function deadline(promise, ms, name) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} did not finish within ${ms} ms`)), ms);
    }),
  ]);
}

// abapGit writes a namespace as #, an import specifier needs it encoded
function specifier(file) {
  return "file://" + file.replaceAll("#", "%23");
}

function includeOf(filename) {
  const match = /\.clas\.(locals_def|locals_imp|macros|testclasses)\.abap$/.exec(filename);
  return match === null ? "main" : {locals_def: "definitions", locals_imp: "implementations", macros: "macros", testclasses: "testclasses"}[match[1]];
}

async function text(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class NotTranspiled extends Error {
  constructor() {
    super("there is no output/ yet: the tests run against the transpiled runtime, so transpile first");
    this.code = "NOT_TRANSPILED";
  }
}

export class RunFailed extends Error {
  constructor(code, output) {
    super(`the test run exited with ${code} and printed no result: ${output}`);
    this.code = "RUN_FAILED";
  }
}

async function main(args) {
  const [type, name] = args;
  if (name === undefined) {
    console.log("usage: osd-unit.mjs TYPE NAME [--class LTCL_X] [--method DOES_Y] [--json] [--detached]");
    return 2;
  }
  const at = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const options = {testClass: at("--class"), method: at("--method")};
  if (args.includes("--plan-stdin")) {
    options.plan = JSON.parse(await text(process.stdin));
  }
  const runner = new UnitRun();
  const result = args.includes("--detached")
    ? await runner.runDetached(type, name, options)
    : await runner.run(type, name, options);
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, undefined, 1));
    return result.ok ? 0 : 1;
  }
  console.log(`${result.program.name}: ${result.counts.methods} methods in ${result.counts.classes} test classes, ${result.counts.passed} passed, ${result.counts.failed} failed, ${result.ms} ms`);
  for (const testClass of result.testClasses) {
    console.log(`  ${testClass.name} (${testClass.riskLevel}, ${testClass.durationCategory})`);
    for (const alert of testClass.alerts) {
      console.log(`    ! ${alert.title}`);
    }
    for (const method of testClass.testMethods) {
      console.log(`    ${method.alerts.length === 0 ? "ok  " : "FAIL"} ${method.name} ${method.executionTime}s`);
      for (const alert of method.alerts) {
        console.log(`         ${alert.kind}: ${alert.title}`);
        for (const detail of alert.details) {
          console.log(`         ${detail}`);
        }
        for (const entry of alert.stack.slice(0, 3)) {
          console.log(`         at ${entry.name}`);
        }
      }
    }
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  });
}
