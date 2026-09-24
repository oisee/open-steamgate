// Zork in the OSGo preview: the page, its WebSocket over a MessageChannel to
// the worker (APC, osgo.apcOpen), the story file out of media/ through the
// worker's fs. Expects the static server of serve.mjs on 4900 with /go.
//   node tools/gogen/wasm/zork-probe.mjs
import {chromium} from "@playwright/test";
import {mkdtempSync} from "node:fs";
const profile = mkdtempSync(new URL("../.out/prof-", import.meta.url).pathname);
const ctx = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() !== "log") console.log("console", m.type(), m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:4900/go/index.html?stay=1");
await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
const t0 = Date.now();
await page.goto("http://127.0.0.1:4900/go/sap/bc/zork/");
try {
  await page.locator("#statusText").filter({hasText: /Connected/}).waitFor({timeout: 60000});
  await page.locator(".xterm-rows").filter({hasText: "small mailbox"}).waitFor({timeout: 60000});
  console.log("zork: connected and west of house in", Date.now() - t0, "ms");
  await page.locator("#terminal").click();
  await page.keyboard.type("open mailbox");
  const t1 = Date.now();
  await page.keyboard.press("Enter");
  await page.locator(".xterm-rows").filter({hasText: /leaflet/i}).waitFor({timeout: 60000});
  console.log("zork: 'open mailbox' answered in", Date.now() - t1, "ms");
} catch (e) {
  console.log("FAIL", e.message.split("\n")[0], "status:", await page.locator("#statusText").innerText().catch(() => "?"));
  console.log((await page.locator("body").innerText()).slice(0, 500));
}
await ctx.close();
