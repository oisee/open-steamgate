import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import {chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {pipeline} from "node:stream/promises";
import {fileURLToPath} from "node:url";

const MODULE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(MODULE, "../..");
const IMAGE = "osd-vsix-bare:code-1.101.2";

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "--skip-image-build") { options[arg.slice(2)] = true; continue; }
    if (!["--vsix", "--release", "--layer"].includes(arg) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error(`unknown or incomplete option: ${arg}`);
    }
    if (options[arg.slice(2)]) throw new Error(`duplicate option: ${arg}`);
    options[arg.slice(2)] = args[++i];
  }
  if (options.vsix && options.release) throw new Error("choose --vsix or --release");
  return options;
}

export function verifyChecksum(text, name, digest) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 1) throw new Error("release checksum must contain exactly one entry");
  const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i.exec(lines[0]);
  if (!match || match[2] !== name || match[1].toLowerCase() !== digest) {
    throw new Error(`SHA-256 verification failed for ${name}`);
  }
}

export function releaseAsset(release) {
  const assets = release.assets.filter(asset => asset.name.endsWith(".vsix"));
  if (assets.length !== 1) throw new Error(`expected one release VSIX, found ${assets.length}`);
  const checksum = release.assets.find(asset => asset.name === `${assets[0].name}.sha256`);
  if (!checksum) throw new Error("release VSIX has no .sha256 asset");
  return {vsix: assets[0], checksum};
}

async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function readableInput(path) {
  const info = await stat(path);
  await chmod(path, info.isDirectory() || (info.mode & 0o111) ? 0o755 : 0o644);
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) await readableInput(join(path, entry));
  }
}

async function fetchResponse(url, accept = "application/octet-stream") {
  const response = await fetch(url, {headers: {Accept: accept, "User-Agent": "osd-vsix-bare-smoke"},
    signal: AbortSignal.timeout(300000)});
  if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
  return response;
}

async function downloadRelease(tag, destination) {
  const release = await (await fetchResponse(
    `https://api.github.com/repos/oisee/open-steamgate/releases/tags/${encodeURIComponent(tag)}`,
    "application/vnd.github+json")).json();
  const {vsix, checksum} = releaseAsset(release);
  // AbortSignal covers the body as well as the response headers.
  await pipeline((await fetchResponse(vsix.browser_download_url)).body, createWriteStream(destination));
  const sum = await (await fetchResponse(checksum.browser_download_url)).text();
  verifyChecksum(sum, vsix.name, await digestFile(destination));
  console.log(`vsix-bare: verified ${tag}/${vsix.name}`);
}

async function run(command, args, timeoutMs, signal, cwd = ROOT, stdio = "inherit") {
  const start = Date.now();
  if (stdio !== "ignore") console.log(`vsix-bare: ${command} ${args.join(" ")}`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {cwd, stdio, signal, killSignal: "SIGKILL"});
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (stdio !== "ignore") console.log(`vsix-bare: ${command} finished in ${((Date.now() - start) / 1000).toFixed(2)} s`);
      if (code === 0 && !expired) resolvePromise();
      else reject(new Error(`${command} ${expired ? "timed out" : `exited ${code ?? signal}`}`));
    });
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log("Usage: node tools/osd-vsix-bare-smoke.mjs [--vsix file | --release tag] [--layer dir] [--skip-image-build]");
    return;
  }
  const started = Date.now();
  const controller = new AbortController();
  const execute = (command, argv, ms) => run(command, argv, ms, controller.signal);
  // Fail early before an expensive VSIX build if there is no Docker daemon.
  await execute("docker", ["info", "--format", "{{.ServerVersion}}"], 30000);
  if (options.layer && !(await stat(resolve(options.layer))).isDirectory()) throw new Error("--layer must be a directory");
  const scratch = await mkdtemp(join(tmpdir(), "osd-vsix-bare-"));
  const container = `osd-vsix-bare-${randomUUID()}`;
  let attempted = false;
  const onSignal = () => { controller.abort(); process.exitCode = 1; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const input = join(scratch, "input");
    await mkdir(input);
    const destination = join(input, "package.vsix");
    if (options.release) await downloadRelease(options.release, destination);
    else {
      let source = options.vsix;
      if (!source) {
        await execute(process.execPath, ["scripts/build-vsix.mjs"], 1200000);
        const pkg = JSON.parse(await readFile(join(ROOT, "build/vsix/stage/extension/package.json"), "utf8"));
        source = join(ROOT, "build/vsix", `open-steamgate-${pkg.version}.vsix`);
      }
      await cp(resolve(source), destination);
    }
    console.log(`vsix-bare: input SHA-256 ${await digestFile(destination)}`);
    if (options.layer) {
      // Dereference so no host symlink can point outside the mounted input.
      await cp(resolve(options.layer), join(input, "layer"), {recursive: true, dereference: true,
        filter: path => ![".git", "node_modules"].includes(basename(path))});
    }
    // The image's non-root user must read even inputs copied from mode 0600.
    await readableInput(input);
    if (!options["skip-image-build"]) {
      await execute("docker", ["build", "--platform", "linux/amd64", "--tag", IMAGE, MODULE], 1200000);
    }
    // No published ports, host network, checkout mount or Docker socket.
    attempted = true;
    await execute("docker", ["run", "--rm", "--init", "--platform", "linux/amd64", "--name", container,
      "--shm-size", "512m", "--mount", `type=bind,src=${input},dst=/input,readonly`, IMAGE], 960000);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (attempted) await run("docker", ["rm", "--force", container], 30000, undefined, ROOT, "ignore").catch(() => {});
    await rm(scratch, {recursive: true, force: true});
    console.log(`vsix-bare: total ${((Date.now() - started) / 1000).toFixed(2)} s`);
  }
}
