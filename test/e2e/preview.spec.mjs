import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Which bundle is answering. This runs first on purpose.
//
// Three times in one day a check passed against something other than what it
// was checking: this suite green against a stale build/sw.js, a deployment
// confirmed because the command exited 0, a fix verified by grepping for a
// comment the bundler strips. Every one of them reported work as done that
// was not. The file on disk being current proves nothing — a service worker
// registration outlives a rebuild, and the old one keeps answering.
//
// So the worker carries a digest of itself (scripts/build-preview.mjs writes
// it in) and says it on request. If this test fails, nothing below it means
// anything, which is why it is first.
test("the worker answering is the worker that was just built", async () => {
  const {readFile} = await import("node:fs/promises");
  const {fileURLToPath} = await import("node:url");
  const onDisk = JSON.parse(await readFile(fileURLToPath(new URL("../../build/build.json", import.meta.url)), "utf8"));

  const profile = await mkdtemp(join(tmpdir(), "stg-preview-stamp-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 30000});
    const answered = await page.evaluate(async () => {
      const res = await fetch("/__preview/build", {cache: "no-store"});
      return {status: res.status, body: await res.json(), sw: true};
    });
    expect(answered.status).toBe(200);
    expect(answered.body.stamp).toBe(onDisk.stamp);
    // and it is unstamped only if the build step never ran
    expect(answered.body.stamp).not.toBe("__OSD_BUILD_STAMP__");
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The static preview build: no server answers /sap/opu/odata/sap/, the
// service worker does, with the transpiled DPC over sql.js.
//
// A persistent profile, because Chromium refuses service worker storage in
// Playwright's ephemeral context on some setups ("Failed to access storage").
test("the list report runs against the gateway in the service worker", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    const answered = [];
    page.on("response", (res) => {
      if (res.url().includes("/sap/opu/odata/sap/")) {
        answered.push(res.status() + " " + res.url().replace("http://localhost:3031", "") + (res.fromServiceWorker() ? " (sw)" : ""));
      }
    });

    // a deep link into the app, without the installer page first
    await page.goto("http://localhost:3031/app/index.html");

    const rows = page.locator("table tbody tr.sapMListTblRow, .sapUiTableRow:has(.sapUiTableCell)");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("Berlin to Copenhagen")).toBeVisible();
    await expect(page.getByText("Aarhus to Odense")).toBeVisible();
    await expect(rows).toHaveCount(4);

    // painted, not only present: an ancestor with height 0 and overflow hidden
    // would leave the row in the DOM and the page blank
    const painted = await page.getByText("Berlin to Copenhagen").evaluate((cell) => {
      const r = cell.getBoundingClientRect();
      return cell.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(painted).toBe(true);

    expect(answered.some((r) => r.includes("$metadata") && r.startsWith("200"))).toBe(true);
    expect(answered.some((r) => r.includes("(sw)"))).toBe(true);
    expect(answered.filter((r) => !r.startsWith("2"))).toEqual([]);

    // the absolute URLs the gateway hands out point at the mount, not at a Node server
    const travels = await page.evaluate(async () => (await fetch("../sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet?$top=1&$format=json")).json());
    expect(travels.d.results[0].__metadata.uri).toMatch(/^http:\/\/localhost:3031\/sap\/opu\/odata\/sap\/ZSTG_DEMO_SRV\/TravelSet\(/);

    // a write goes through the DPC in the worker and survives a reload
    const created = await page.evaluate(async () => {
      const res = await fetch("../sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet", {
        method: "POST",
        headers: {"content-type": "application/json", "x-csrf-token": "open-steamgate"},
        body: JSON.stringify({TravelId: "T0900", Description: "Preview roundtrip"}),
      });
      return res.status;
    });
    expect(created).toBe(201);
    await page.reload();
    await expect(page.getByText("Preview roundtrip")).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The same worker answers the other ICF services, not only the OData front.
//
// Before this, both the worker and the backend named one prefix and one
// handler class in their own source, which was true while there was one of
// each. A repository imported under local/ brings its own *.sicf.xml, the
// build writes the table, and both read it — so a page generated by ABAP is
// served by ABAP with no server anywhere.
test("an ICF service is served by the worker too, page and all", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-icf-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();

    // the installer page registers the worker and then navigates to the app,
    // so land somewhere stable before asking anything of the page: an
    // evaluate that runs mid-navigation dies with "execution context was
    // destroyed" and reads like a worker fault rather than a race
    await page.goto("http://localhost:3031/index.html");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 30000});
    await page.goto("http://localhost:3031/sap/bc/zork");
    await page.waitForLoadState("domcontentloaded");

    const answer = await page.evaluate(async () => {
      const res = await fetch("/sap/bc/zstg_icf_demo/a/b");
      return {status: res.status, body: await res.text()};
    });

    expect(answer.status).toBe(200);
    // the handler ran: it reports its own name and the path below its mount,
    // which a static file could not do
    expect(answer.body).toContain('"service":"ZSTG_ICF_DEMO"');
    expect(answer.body).toContain('"path":"/a/b"');
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// A push channel with no socket and no second runtime.
//
// The page opens ws://…/sap/bc/apc/sap/… in its own script, before anything
// the deployment adds could replace the constructor, so the worker injects
// the shim ahead of it. The shim is a WebSocket shape over a MessagePort;
// the handler runs in the worker, where the runtime already is.
test("an APC channel answers in the bundle, with the handler in the worker", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-apc-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    // the installer page navigates away once the worker is registered, so
    // land on a page the worker serves and stay there
    await page.goto("http://localhost:3031/index.html");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 30000});
    await page.goto("http://localhost:3031/sap/bc/zork");
    await page.waitForLoadState("domcontentloaded");

    // the worker put the shim into the ABAP-generated page ahead of its own
    // script, which is the only moment it could have
    expect(await page.evaluate(() => globalThis.WebSocket.__previewInstalled === true)).toBe(true);

    // no install( ) here on purpose. The worker injected the shim into the
    // page and that is the thing under test: an earlier version injected a
    // module, which is deferred, so it ran after the page's own script had
    // already opened its socket and failed. This test called install( )
    // itself and passed while the real path was broken.
    const frames = await page.evaluate(async () => {
      return await new Promise((done, fail) => {
        const got = [];
        const socket = new WebSocket("ws://localhost:3031/sap/bc/apc/sap/zstg_apc_demo");
        // sending from onopen is what a page does, and it is what caught the
        // ordering defect: the handler speaks from on_start, so draining
        // before signalling open delivered a message while the socket was
        // still CONNECTING, onmessage ran before onopen, and the page's reply
        // was refused as "the socket is not open"
        socket.onopen = () => { socket.send("ping"); socket.send("hello"); };
        socket.onerror = () => fail(new Error("error before the exchange finished"));
        socket.onmessage = (e) => { got.push(e.data); if (got.length >= 3) { done(got); } };
        socket.onclose = (e) => fail(new Error("closed: " + e.reason));
        setTimeout(() => fail(new Error("timed out with " + JSON.stringify(got))), 20000);
      });
    });

    // on_start speaks first, then the two answers
    expect(frames[0]).toContain('"channel":"ZSTG_APC_DEMO"');
    expect(frames[1]).toBe("pong");
    // the counter proves one handler object served both messages, which is
    // what stateful means and what a per-message object would not show
    expect(frames[2]).toContain('"seen":2');
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// SMW0 media in the bundle.
//
// The runtime reads a W3MI object with WWWDATA_IMPORT, which reads a file
// beside the transpiled module. There is no file and no fs in a service
// worker, so every page that showed a picture or played a sound got a 500
// from a gateway that was otherwise answering. The build carries the media
// under media/ and web/preview-backend.mjs installs abap.W3MI_LOADER, so the
// bytes come back over fetch and the ABAP above is unchanged.
test("SMW0 objects are served from the bundle, byte for byte", async () => {
  const {readFile} = await import("node:fs/promises");
  const {fileURLToPath} = await import("node:url");
  const output = fileURLToPath(new URL("../../output/", import.meta.url));
  const expected = {
    "ZO4D_05_COPPER.PNG": await readFile(output + "zo4d_05_copper%2epng.w3mi.data.png"),
    "ZOISEE-EAR-02.MP3": await readFile(output + "zoisee-ear-02%2emp3.w3mi.data.mp3"),
  };

  const profile = await mkdtemp(join(tmpdir(), "stg-preview-w3mi-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout: 30000});
    // somewhere the worker serves and nothing else happens: the Zork page
    // opens its channel on load, and a handler that boots a Z-machine in the
    // worker holds the only thread there is, so waiting for that page's load
    // event is waiting for the game to start
    await page.goto("http://localhost:3031/sap/bc/zstg_icf_demo/media", {waitUntil: "domcontentloaded"});

    const fetched = await page.evaluate(async () => {
      const one = async (query) => {
        const res = await fetch("/sap/bc/zo4d_demo?" + query);
        const body = new Uint8Array(await res.arrayBuffer());
        // a digest rather than the bytes: four megabytes through the
        // Playwright bridge is the slow part of this test, not the runtime
        const digest = await crypto.subtle.digest("SHA-256", body);
        return {
          status: res.status,
          type: res.headers.get("content-type"),
          length: body.length,
          sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
        };
      };
      return {
        image: await one("img=ZO4D_05_COPPER.PNG"),
        audio: await one("audio=ZOISEE-EAR-02.MP3"),
      };
    }, undefined, {timeout: 60000});

    const {createHash} = await import("node:crypto");
    const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

    expect(fetched.image.status).toBe(200);
    expect(fetched.image.type).toContain("image/png");
    expect(fetched.image.length).toBe(expected["ZO4D_05_COPPER.PNG"].length);
    expect(fetched.image.sha256).toBe(sha(expected["ZO4D_05_COPPER.PNG"]));

    // the audio is the four megabyte case: the one that turned the whole
    // WWWDATA_IMPORT walk quadratic on the Node side and the one nobody would
    // notice was missing until a demo went silent
    expect(fetched.audio.status).toBe(200);
    expect(fetched.audio.type).toContain("audio/mpeg");
    expect(fetched.audio.length).toBe(expected["ZOISEE-EAR-02.MP3"].length);
    expect(fetched.audio.sha256).toBe(sha(expected["ZOISEE-EAR-02.MP3"]));
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
