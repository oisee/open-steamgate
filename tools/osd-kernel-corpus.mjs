// Pinned, content-checked input cache. The ABAPiti checkout is read only.
import {createHash} from "node:crypto";
import {spawnSync, execFileSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {runsAs} from "./osd-main.mjs";

export const root = resolve(import.meta.dirname, "..");
export const readJSON = (path) => JSON.parse(readFileSync(path, "utf8"));
export const pin = () => {
  const value = readFileSync(join(root, ".github/ci/abapiti.ref"), "utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("abapiti.ref must be a full commit hash");
  return value;
};
export function fingerprint(directory) {
  const files = readdirSync(directory).filter((f) => /\.(abap|xml)$/.test(f)).sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(file + "\0").update(readFileSync(join(directory, file))).update("\0");
  return {files: files.length, sha256: hash.digest("hex")};
}
export function verifyCorpus(directory, manifest, names) {
  if (manifest.abapiti !== pin()) throw new Error("corpus manifest and ABAPiti pin differ");
  for (const name of names) {
    if (!existsSync(join(directory, name))) throw new Error(`${name}: missing pinned fixture; see docs/ci-tests.md (public source follow-up)`);
    const actual = fingerprint(join(directory, name)), expected = manifest.folders[name];
    if (!expected || actual.files !== expected.files || actual.sha256 !== expected.sha256) throw new Error(`${name}: corpus content differs from pinned manifest`);
  }
}
export function goEnv(work) {
  const env = {...process.env, GOTOOLCHAIN: "go1.26.0", GOFLAGS: "-buildvcs=false",
    GOPATH: join(work, "go-path"), GOMODCACHE: join(work, "go-mod"), GOCACHE: join(work, "go-cache")};
  for (const key of ["GOPATH", "GOMODCACHE", "GOCACHE"]) mkdirSync(env[key], {recursive: true});
  return env;
}
export function prepare({source = join(root, ".local/abapiti-src"), work = join(root, ".local/kernelci")} = {}) {
  source = resolve(source); work = resolve(work);
  const ref = pin(), manifest = readJSON(join(root, ".github/ci/kernel-corpus.json"));
  const corpus = join(work, "corpus"), fast = ["TestOSD_EmitUnitClasses", "int8"];
  // Cache hits are rehashed, not trusted solely because the directory exists.
  if (!existsSync(join(corpus, "TestOSD_EmitUnitClasses"))) {
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {cwd: source, encoding: "utf8"}).trim();
    if (actual !== ref || execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {cwd: source, encoding: "utf8"}).trim()) throw new Error("ABAPiti checkout must be clean and at abapiti.ref");
    const license = readFileSync(join(source, "LICENSE"), "utf8");
    if (!license.startsWith("MIT License")) throw new Error("pinned ABAPiti licence is not MIT");
    mkdirSync(work, {recursive: true});
    const temp = mkdtempSync(join(work, "generate-"));
    try {
      const generated = join(temp, "generated");
      const run = spawnSync("go", ["test", "./wasm", "-count=1", "-run", "^TestOSD_EmitUnitClasses$"], {
        cwd: source, env: {...goEnv(work), ABAPITI_TEST_OUT: generated}, encoding: "utf8", timeout: 300000, maxBuffer: 8e6,
      });
      writeFileSync(join(work, "generate.log"), (run.stdout ?? "") + (run.stderr ?? ""));
      if (run.error || run.status !== 0) throw new Error(`corpus generation failed: ${run.error?.message ?? run.status}; see generate.log`);
      const output = join(corpus, fast[0]); mkdirSync(output, {recursive: true});
      const input = join(generated, fast[0]);
      for (const dir of [input, join(input, "split")]) for (const file of readdirSync(dir).filter((f) => f.endsWith(".abap"))) {
        if (existsSync(join(output, file))) throw new Error(`duplicate generated file: ${file}`);
        cpSync(join(dir, file), join(output, file));
      }
      cpSync(join(source, "LICENSE"), join(corpus, "ABAPiti-LICENSE"));
    } finally { rmSync(temp, {recursive: true, force: true}); }
  }
  if (!existsSync(join(corpus, "int8"))) {
    mkdirSync(join(corpus, "int8"), {recursive: true});
    for (const name of ["int8x", "int8y"]) for (const [suffix, target] of [[".abap", ".clas.abap"], ["-testclasses.abap", ".clas.testclasses.abap"]]) {
      cpSync(join(root, "test/fixtures/osgjs-unit-int8", name + suffix), join(corpus, "int8", "zcl_abapiti_" + name + target));
    }
  }
  verifyCorpus(corpus, manifest, fast);
  return corpus;
}

if (runsAs("osd-kernel-corpus.mjs")) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = {"--source": "source", "--work": "work"}[process.argv[i]];
      if (!key || !process.argv[i + 1]) throw new Error("usage: osd-kernel-corpus.mjs [--source dir] [--work dir]");
      options[key] = process.argv[i + 1];
    }
    console.log(prepare(options));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
