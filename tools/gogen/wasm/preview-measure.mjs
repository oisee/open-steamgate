// Measures a preview in headless Chromium: the OSGo one (Go -> wasm in a
// service worker) and the JS one (the transpiler's output in a service
// worker), one after the other, each in a fresh profile, with one
// instrument (performance.now() in the page around fetch) and one statistic
// (the median):
//
//   node tools/gogen/wasm/preview-measure.mjs <origin> go=/go js=/js [--runs 50] [--rounds 3] [--profiles <dir>]
//
// --rounds alternates the runtimes (go, js, go, js, ...), each round in a
// fresh profile, and reports per number the median over the rounds: on a
// shared machine the load moves more than the runtimes differ.
//
// Per runtime: the cold start (worker in control, then the first OData
// answer, which starts the runtime), the Travels list request as the list
// report sends it (warm, median of --runs), the list report page until its
// first row is painted, and the launchpad -> Travels tile -> list -> object
// page walk.
import {chromium} from "@playwright/test";
import {mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";

const args = process.argv.slice(2);
const origin = args[0];
const runtimes = args.slice(1).filter((a) => a.includes("=") && !a.startsWith("--")).map((a) => a.split("="));
const rounds = Number(args.includes("--rounds") ? args[args.indexOf("--rounds") + 1] : 1);
const runs = Number(args.includes("--runs") ? args[args.indexOf("--runs") + 1] : 50);
const profiles = args.includes("--profiles") ? args[args.indexOf("--profiles") + 1] : join(import.meta.dirname, "..", ".out", "profiles");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
// the list report's first request for the Travels table (read off the app's
// own traffic in both previews): the same URL for both runtimes
const LIST = "sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$skip=0&$top=20&$inlinecount=allpages";

const all = {};
for (let round = 0; round < rounds; round++) for (const [name, mount] of runtimes) {
  const base = `${origin}${mount}/`;
  const profile = join(profiles, `${name}-${Date.now()}`);
  rmSync(profile, {recursive: true, force: true});
  mkdirSync(profile, {recursive: true});
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  const out = {};
  (all[name] ??= []).push(out);
  let page;
  try {
    page = await context.newPage();
    const failures = [];
    page.on("response", (res) => { if (res.url().includes("/sap/") && res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
    await page.goto(`${base}index.html?stay=1`);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 60_000});
    // cold: the first OData answer starts the runtime in the worker
    out.coldFirstAnswerMs = r1(await page.evaluate(async () => {
      const t0 = performance.now();
      const r = await fetch("sap/opu/odata/sap/ZSTG_DEMO_SRV/", {headers: {accept: "application/json"}});
      await r.text();
      if (!r.ok) throw new Error(`first answer ${r.status}`);
      return performance.now() - t0;
    }));
    if (name === "go") out.workerInfo = await page.evaluate(async () => (await fetch("__osgo/info")).json());
    // warm: the Travels list request, one at a time
    const times = await page.evaluate(async ({url, runs}) => {
      const ts = [];
      const inside = [];
      for (let i = 0; i < runs + 5; i++) {
        const t0 = performance.now();
        const r = await fetch(url, {headers: {accept: "application/json"}});
        const j = await r.json();
        if (!j.d || !j.d.results) throw new Error("no results");
        ts.push(performance.now() - t0);
        const st = /osgo;dur=([\d.]+)/.exec(r.headers.get("server-timing") ?? "");
        if (st) inside.push(Number(st[1]));
      }
      return {ts: ts.slice(5), inside: inside.slice(5)};
    }, {url: LIST, runs}).then((x) => {
      if (x.inside.length) out.travelsListInWorkerMedianMs = r1(median(x.inside));
      return x.ts;
    });
    out.travelsListMedianMs = r1(median(times));
    if (name === "go") {
      // the worker's own round trip, nothing behind it (osgo-sw.js PING_PATH)
      const ping = await page.evaluate(async (runs) => {
        const ts = [];
        for (let i = 0; i < runs + 5; i++) {
          const t0 = performance.now();
          await (await fetch("__osgo/ping")).json();
          ts.push(performance.now() - t0);
        }
        return ts.slice(5);
      }, runs);
      out.workerRoundTripMedianMs = r1(median(ping));
    }
    out.travelsListP90Ms = r1([...times].sort((a, b) => a - b)[Math.floor(times.length * 0.9)]);
    // the list report page, warm runtime: navigation to the first row painted
    {
      const t0 = Date.now();
      await page.goto(`${base}app/index.html`);
      await page.getByText("Berlin to Copenhagen").first().waitFor({timeout: 60_000});
      out.listReportPageMs = Date.now() - t0;
    }
    // launchpad -> Travels -> object page
    {
      const t0 = Date.now();
      await page.goto(`${base}app/flp.html`);
      const tile = page.locator(".sapMGT, .sapUshellTile", {hasText: "Travels"}).first();
      await tile.waitFor({timeout: 60_000});
      out.launchpadTilesMs = Date.now() - t0;
      await tile.click();
      out.step = "list after tile";
      await page.getByText("Berlin to Copenhagen").first().waitFor({timeout: 60_000});
      const t1 = Date.now();
      await page.getByText("Berlin to Copenhagen").first().click();
      out.step = "object page";
      await page.waitForURL(/TravelSet|Travel\(|TravelId/, {timeout: 60_000});
      // the object page (beside the list: the app is a flexible column
      // layout) with its bookings table filled
      await page.getByText(/^Bookings \(\d+\)$/).first().waitFor({timeout: 60_000});
      out.objectPageMs = Date.now() - t1;
      out.objectPageUrl = page.url().replace(origin, "");
    }
    out.failedRequests = failures;
  } catch (e) {
    out.error = String(e.message || e).split("\n")[0];
    if (page) {
      out.errorUrl = page.url();
      out.errorText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
      await page.screenshot({path: join(profiles, `${name}-error.png`)}).catch(() => {});
    }
  } finally {
    await context.close();
    rmSync(profile, {recursive: true, force: true});
  }
  console.log(`round ${round + 1}`, name, JSON.stringify({...out, failedRequests: out.failedRequests?.length}));
}
// per runtime, each number the median of its rounds
const results = {};
for (const [name, outs] of Object.entries(all)) {
  const r = results[name] = {rounds: outs.length, errors: outs.filter((o) => o.error).map((o) => o.error)};
  for (const key of Object.keys(outs[0])) {
    const xs = outs.map((o) => o[key]).filter((x) => typeof x === "number");
    if (xs.length) r[key] = r1(median(xs));
  }
  const info = outs.map((o) => o.workerInfo).filter(Boolean);
  for (const key of ["sqljsMs", "wasmMs", "goStartMs", "goSeedMs", "totalMs"]) if (info.length) r[`worker.${key}`] = median(info.map((i) => i[key]));
  r.failedRequests = [...new Set(outs.flatMap((o) => o.failedRequests ?? []).map((u) => u.replace(origin, "")))];
}
console.log(JSON.stringify(results, null, 1));
