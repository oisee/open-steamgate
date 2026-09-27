// End-to-end VS Code web extension check. @vscode/test-web serves VS Code;
// Playwright drives one persistent Chromium profile through a page reload.
import {spawn} from "node:child_process";
import {mkdtemp, rm, stat} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {chromium} from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const extension = join(root, "editors/vscode");
// Always rebuild before launching VS Code so this check exercises current sources.
const build = spawn("npm", ["run", "web:vscode"], {cwd: root, stdio: "inherit"});
const buildExit = await new Promise((resolveExit, reject) => {
  build.on("error", reject);
  build.on("close", resolveExit);
});
if (buildExit !== 0) throw new Error(`npm run web:vscode failed (exit ${buildExit})`);
await stat(join(extension, "dist/web/extension.js")).catch(() => {
  throw new Error("Web extension bundle is missing after npm run web:vscode");
});

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

const temp = await mkdtemp(join(tmpdir(), "osd-vscode-web-"));
const port = await freePort();
const origin = `http://localhost:${port}`;
let server;
let context;
let page;
let serverOutput = "";
const browserLog = [];

async function waitForServer() {
  const until = Date.now() + 15 * 60 * 1000; // first run downloads VS Code
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`@vscode/test-web exited early:\n${serverOutput.slice(-4000)}`);
    try {
      const answer = await fetch(origin);
      if (answer.ok) return;
    } catch { /* download or server start in progress */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`@vscode/test-web did not start:\n${serverOutput.slice(-4000)}`);
}

async function command(page, title, marker) {
  await page.keyboard.press("Control+Shift+P");
  const input = page.locator(".quick-input-widget input").first();
  await input.waitFor({timeout: 30000});
  await input.fill(`>${title}`);
  const choice = page.locator(".quick-input-list .monaco-list-row").filter({hasText: title}).first();
  await choice.waitFor({timeout: 30000});
  await choice.click();
  await page.waitForFunction((name) => {
    const text = (document.querySelector(".output-view .view-lines")?.textContent ?? "").replaceAll("\u00a0", " ");
    return text.includes(`${name} {`) || text.includes(`${name}_ERROR`);
  }, marker, {timeout: 180000});
  const text = (await page.locator(".output-view .view-lines").textContent()).replaceAll("\u00a0", " ");
  const error = text.match(new RegExp(`${marker}_ERROR ([\\s\\S]*)`));
  if (error) throw new Error(error[1].slice(0, 2000));
  const match = text.match(new RegExp(`${marker} (\\{[^}]+\\})`));
  if (!match) throw new Error(`${marker} result missing from Output: ${text.slice(-2000)}`);
  return JSON.parse(match[1]);
}

try {
  server = spawn("npx", ["-y", "@vscode/test-web", "--browser", "none",
    "--quality", "stable", "--extensionDevelopmentPath", extension,
    "--testRunnerDataDir", process.env.OSD_WEB_TEST_DATA_DIR ?? join(temp, "vscode"), "--port", String(port)], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {...process.env, npm_config_cache: join(temp, "npm-cache")},
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput = (serverOutput + chunk.toString()).slice(-12000);
      process.stdout.write(chunk);
    });
  }
  await waitForServer();
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    headless: true, args: ["--no-sandbox"], viewport: {width: 1440, height: 900},
  });
  page = context.pages()[0] ?? await context.newPage();
  page.on("console", (message) => browserLog.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => browserLog.push(`pageerror: ${error.stack ?? error}`));
  await page.goto(origin, {waitUntil: "domcontentloaded"});
  await page.locator(".monaco-workbench").waitFor({timeout: 120000});

  const probe = await command(page, "osd: Web probe", "OSD_WEB_PROBE");
  if (probe.metadata !== 200 || probe.post !== 201 || probe.get !== 200 || !/^W[A-Z0-9]{7}$/.test(probe.id)) {
    throw new Error(`Invalid probe result: ${JSON.stringify(probe)}`);
  }
  if (!Number.isFinite(probe.activationToMetadataMs) || !Number.isFinite(probe.commandToMetadataMs)) {
    throw new Error(`Missing $metadata timing: ${JSON.stringify(probe)}`);
  }
  console.log(`Probe: $metadata ${probe.metadata}, POST ${probe.post}, GET ${probe.get}, ${probe.id}`);
  console.log(`Activation to first $metadata: ${probe.activationToMetadataMs} ms`);
  console.log(`Command to $metadata response: ${probe.commandToMetadataMs} ms`);

  await page.reload({waitUntil: "domcontentloaded"});
  await page.locator(".monaco-workbench").waitFor({timeout: 120000});
  const verified = await command(page, "osd: Web verify last Travel", "OSD_WEB_VERIFY");
  if (verified.get !== 200 || verified.id !== probe.id || verified.description !== probe.description) {
    throw new Error(`IndexedDB reload check failed: ${JSON.stringify(verified)}`);
  }
  console.log(`After reload: GET ${verified.get}, same row ${verified.id}`);

  await page.keyboard.press("Control+Shift+P");
  const input = page.locator(".quick-input-widget input").first();
  await input.fill(">osd: Web probe view");
  await page.locator(".quick-input-list .monaco-list-row").filter({hasText: "osd: Web probe view"}).first().click();
  let bridged = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !bridged) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const body = await frame.locator("body").textContent({timeout: 1000}).catch(() => "");
      if (body?.includes("200") && body.includes("Edmx")) {
        bridged = true;
        break;
      }
    }
    if (!bridged) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (!bridged) throw new Error("Webview postMessage bridge did not display $metadata 200");
  console.log("Webview postMessage bridge: $metadata 200");
} catch (error) {
  console.error(error);
  console.error("Workbench text:", (await page?.locator("body").innerText().catch(() => ""))?.slice(-3000));
  console.error("Output text:", await page?.locator(".output-view").textContent().catch(() => ""));
  console.error("Browser log:", browserLog.slice(-40).join("\n"));
  process.exitCode = 1;
} finally {
  await context?.close();
  if (server?.pid && server.exitCode === null) {
    // Detached process group consists of this script's npx and its children.
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* already exited */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  await rm(temp, {recursive: true, force: true});
}
