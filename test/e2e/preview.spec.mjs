import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

// Wait for the worker to take control, and say what happened when it does not.
//
// The bare wait was `waitForFunction(() => controller !== null)` with a
// timeout, which reports "Timeout 30000ms exceeded" and nothing else. That
// sentence is the same whether the registration was refused, the worker is
// still installing, or the browser cannot open service-worker storage at
// all — three different faults with one face. web/index.html already catches
// a registration failure and renders it into the page; nobody was reading it.
//
// Suggested by a Codex review of exactly this problem, and it is the day's
// lesson again in a new place: a check that says nothing when it fails is
// barely a check.
async function controlled(page, timeout = 60000) {
  try {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {timeout});
  } catch (waited) {
    const said = await page.evaluate(() => ({
      body: document.body.innerText.replace(/\s+/g, " ").slice(0, 600),
      registrations: navigator.serviceWorker.getRegistrations === undefined
        ? "getRegistrations is not available"
        : undefined,
    })).catch((reason) => ({body: `the page could not be read: ${reason.message}`}));
    const states = await page.evaluate(async () => {
      const all = await navigator.serviceWorker.getRegistrations();
      return all.map((r) => `scope=${r.scope} installing=${r.installing?.state ?? "-"} waiting=${r.waiting?.state ?? "-"} active=${r.active?.state ?? "-"}`);
    }).catch((reason) => [`registrations could not be read: ${reason.message}`]);
    throw new Error(`the worker never took control in ${timeout}ms.\n  page said: ${said.body}\n  registrations: ${states.length === 0 ? "(none)" : states.join(" | ")}\n  original: ${waited.message.split("\n")[0]}`);
  }
}

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
  const onDisk = JSON.parse(await readFile(fileURLToPath(new URL("../../build/preview/build.json", import.meta.url)), "utf8"));

  const profile = await mkdtemp(join(tmpdir(), "stg-preview-stamp-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    // land somewhere stable first. index.html is the installer and navigates
    // to the app the moment the worker is in control, so anything evaluated
    // on it races that navigation and dies as "execution context was
    // destroyed" — which reads like a worker fault and is not one. This is
    // the same race that made the suite flake.
    await page.goto("http://localhost:3031/sap/bc/zstg_icf_demo/stamp", {waitUntil: "domcontentloaded"});
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
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
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

// The demo is a pack, fetched from its own repository at a pinned commit
// (packs/o4d/osd-pack.json, tools/osd-fetch.mjs), and it reaches the
// deployment the way Zork does: its ICF node is in the services table, its
// page is written by ZCL_O4D_HTTP_HANDLER in the worker, its pictures come
// out of SMW0 through media/. This checks the page and one picture, which
// is the whole chain short of the socket that the Zork tests cover.
test("the demo pack is served: its page by the handler, a picture out of SMW0", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-o4d-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    const answer = await page.evaluate(async () => {
      const res = await fetch("/sap/bc/zo4d_demo/");
      return {status: res.status, type: res.headers.get("content-type"), body: await res.text()};
    });
    expect(answer.status).toBe(200);
    expect(answer.type).toContain("text/html");
    expect(answer.body).toContain("VIVID VIBES");
    // a picture the page asks the handler for, answered from the media folder
    const picture = await page.evaluate(async () => {
      const res = await fetch("/sap/bc/zo4d_demo/?img=ZO4D_00_SALES.PNG");
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {status: res.status, type: res.headers.get("content-type"), head: Array.from(bytes.slice(0, 4))};
    });
    expect(picture.status).toBe(200);
    expect(picture.head).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // and the launchpad knows the packs
    const packs = await page.evaluate(async () => (await fetch("/app/packs.json")).json());
    expect(Array.isArray(packs.tiles)).toBe(true);
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The demo over its channel, not only its page: a page that opens the
// socket, loads the demo and asks for a frame must get the frame and keep
// the socket. It did not: the handler WRITEs a debug line per frame, the
// runtime's console wrote to a process.stdout the worker does not have, and
// the channel closed with 1011 on the first frame while the page said
// "Disconnected" (measured 2026-09-17 on Pages, reproduced here).
test("the demo answers a frame over its channel and the socket stays open", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-o4d-frame-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    await page.goto("http://localhost:3031/sap/bc/zork", {waitUntil: "domcontentloaded", timeout: 60000});
    const answer = await page.evaluate(() => new Promise((resolve) => {
      const socket = new WebSocket("ws://localhost:3031/sap/bc/apc/sap/zo4d_demo");
      const seen = [];
      const done = (why) => resolve({why, state: socket.readyState, seen});
      socket.addEventListener("close", (e) => done(`closed ${e.code} ${e.reason}`));
      socket.addEventListener("error", () => done("error"));
      socket.addEventListener("message", (e) => {
        const text = String(e.data);
        seen.push(text.slice(0, 40));
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.type === "scenario") {
          socket.send(JSON.stringify({cmd: "frame", tick: 0, sub: 0}));
        } else if (message.t !== undefined) {
          setTimeout(() => done(`frame ${message.e}`), 500);
        }
      });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({cmd: "load_demo", demo: "main"}));
        socket.send("start");
        socket.send(JSON.stringify({cmd: "get_scenario"}));
      });
      setTimeout(() => done("timeout"), 30000);
    }));
    expect(answer.why).toBe("frame Sales Dance");
    expect(answer.state).toBe(1);
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The light-show pack: SAP GUI screens recorded by sap-tui and handed out
// by line over a push channel (packs/lsd). The page speaks no DIAG; this
// checks the channel says how long the show is and answers the first lines
// with the recording's header.
test("the LSD channel hands out the recorded show by line", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-lsd-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    await page.goto("http://localhost:3031/sap/bc/zork", {waitUntil: "domcontentloaded", timeout: 60000});
    const answer = await page.evaluate(() => new Promise((resolve) => {
      const socket = new WebSocket("ws://localhost:3031/sap/bc/apc/sap/zapc_lsd");
      let lines = 0;
      const done = (why, head) => resolve({why, lines, head, state: socket.readyState});
      socket.addEventListener("close", (e) => done(`closed ${e.code} ${e.reason}`));
      socket.addEventListener("error", () => done("error"));
      socket.addEventListener("message", (e) => {
        const text = String(e.data);
        if (text.startsWith("{\"type\":\"show\"")) {
          lines = JSON.parse(text).lines;
          socket.send(JSON.stringify({cmd: "lines", from: 0, to: 3}));
        } else {
          done("lines", text.split("\n").map((l) => l.slice(0, 40)));
        }
      });
      setTimeout(() => done("timeout"), 60000);
    }));
    expect(answer.why).toBe("lines");
    expect(answer.lines).toBeGreaterThan(1000);
    expect(answer.head[0]).toContain("\"v\":1");
    expect(answer.head[1]).toContain("\"s\":");
    expect(answer.state).toBe(1);
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
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
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
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
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

// A real stateful handler, end to end, which the synthetic one cannot prove.
//
// Alice's suggestion, and the right one: Zork exercises more of the bundle in
// one go than the demo does and has none of its unrelated trouble. The page
// opens its own socket in its own script, so the injected shim has to be
// there first; the handler is a stateful APC class with a Z-machine behind
// it; and the story file is an SMW0 object, so the media path is in the
// chain too. If any link is missing the terminal says DISCONNECTED instead
// of the game.
test("Zork plays in the bundle: shim, channel, stateful handler and SMW0", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-zork-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    // domcontentloaded, not load: the page connects as it loads and the
    // handler boots a Z-machine in the worker, which is the only thread
    // there is, so waiting for the load event is waiting for the game
    await page.goto("http://localhost:3031/sap/bc/zork", {waitUntil: "domcontentloaded", timeout: 60000});

    // the handler accepted the connection
    await expect(page.locator("#statusText")).toHaveText("Connected - Playing ZORK", {timeout: 60000});

    // and it ran: the banner is the handler's own, the rest is the story
    // file out of SMW0 interpreted by the ABAP Z-machine
    await expect(page.getByText("Z-Machine V3 Interpreter in ABAP")).toBeVisible({timeout: 60000});
    await expect(page.getByText("West of House")).toBeVisible({timeout: 60000});

    // and it answers. Typed into the page's own terminal rather than pushed
    // down a socket this test opened, so the path under test is the one a
    // player uses: xterm -> the injected shim -> the worker -> on_message.
    const type = async (command) => {
      await page.locator("#terminal").click();
      await page.keyboard.type(command);
      await page.keyboard.press("Enter");
    };
    await type("open mailbox");
    await expect(page.getByText("Opening the small mailbox reveals a leaflet.")).toBeVisible({timeout: 60000});

    // the second command is the point. It can only work if the mailbox is
    // still open, which is state the previous message left behind — one
    // handler object for the conversation, which is what stateful APC means
    // and what a fresh handler per message would fail here.
    await type("read leaflet");
    await expect(page.getByText("WELCOME TO ZORK", {exact: false})).toBeVisible({timeout: 60000});
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The walkthrough, replayed. Alice remembered this existed and it does.
//
// .local/cpm-abap/test-games/MINIZORK_TEST.TXT is a script of commands with
// assertions between them — %*pattern* for "the answer contains this",
// %=text for the exact spelling, %!pattern for "must not". It is already the
// oracle for the ABAP side, run there by ltcl_speedrun, and replaying it
// through the bundle asks a harder question than any assertion of mine: not
// "did the handler answer" but "does the game play the same when the Z-machine
// is transpiled, the story file comes out of SMW0 and the socket is a
// MessagePort".
//
// It lives outside the repository, so this skips rather than fails when the
// cpm-abap checkout is absent, the way the corpus suites do.
const SCRIPT = ".local/cpm-abap/test-games/MINIZORK_TEST.TXT";

function parseScript(text) {
  const steps = [{command: undefined, expects: []}];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("%")) {
      const body = line.slice(1);
      if (body.startsWith("=")) {
        steps.at(-1).expects.push({kind: "exact", pattern: body.slice(1)});
      } else if (body.startsWith("!")) {
        steps.at(-1).expects.push({kind: "absent", pattern: body.slice(1)});
      } else {
        // %*pattern* — the stars are the wildcard, the middle is the text
        steps.at(-1).expects.push({kind: "contains", pattern: body.replace(/^\*|\*$/g, "")});
      }
      continue;
    }
    steps.push({command: line, expects: []});
  }
  return steps;
}

test("the MiniZork walkthrough plays the same in the bundle", async () => {
  const {readFile} = await import("node:fs/promises");
  const {fileURLToPath} = await import("node:url");
  const path = fileURLToPath(new URL("../../" + SCRIPT, import.meta.url));
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    test.skip(true, `${SCRIPT} is not in this checkout`);
    return;
  }
  const steps = parseScript(text);
  expect(steps.filter((s) => s.expects.length > 0).length).toBeGreaterThan(10);

  const profile = await mkdtemp(join(tmpdir(), "stg-preview-walk-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);
    await page.goto("http://localhost:3031/sap/bc/zstg_icf_demo/walkthrough", {waitUntil: "domcontentloaded"});

    const answers = await page.evaluate(async (script) => {
      const {install} = await import("/preview-socket.mjs");
      install({paths: ["/sap/bc/apc/sap"]});
      const socket = new WebSocket("ws://localhost:3031/sap/bc/apc/sap/zapc_zork");
      let buffer = "";
      // a channel that dies mid-walkthrough must name the command that
      // killed it; without this the next send throws "the socket is not
      // open" and the report blames the test rather than the game
      let died;
      socket.onmessage = (event) => { buffer += event.data; };
      socket.onclose = (e) => { died = died ?? `closed ${e.code} ${e.reason || "(no reason)"}`; };
      socket.onerror = () => { died = died ?? "socket error"; };
      await new Promise((open, fail) => {
        socket.onopen = open;
        setTimeout(() => fail(new Error(died ?? "no open")), 20000);
      });
      // the game has spoken when it stops: a prompt and then quiet
      const settle = async () => {
        for (let waited = 0; waited < 20000; waited += 100) {
          const was = buffer.length;
          await new Promise((tick) => setTimeout(tick, 100));
          if (buffer.length === was && buffer.trimEnd().endsWith(">")) {
            break;
          }
        }
        const said = buffer;
        buffer = "";
        return said;
      };
      const out = [];
      for (const step of script) {
        if (died !== undefined) {
          return {out, died, stoppedAt: step.command ?? "(intro)"};
        }
        if (step.command !== undefined) {
          socket.send(step.command);
        }
        out.push(await settle());
      }
      socket.close();
      return {out};
    }, steps);

    // every assertion in the script, against the answer to its own command
    const failures = [];
    steps.forEach((step, at) => {
      // only what actually ran: once the channel dies the remaining steps
      // have no answer, and reporting those as failed assertions buries the
      // one thing that went wrong under a list of things that never happened
      if (at >= answers.out.length) {
        return;
      }
      const said = answers.out[at];
      for (const {kind, pattern} of step.expects) {
        const hit = kind === "exact"
          ? said.includes(pattern)
          : said.toLowerCase().includes(pattern.toLowerCase());
        if (kind === "absent" ? hit : hit === false) {
          failures.push(`${step.command ?? "(intro)"} -> ${kind} ${JSON.stringify(pattern)}; got ${JSON.stringify(said.trim().slice(0, 120))}`);
        }
      }
    });
    expect(failures).toEqual([]);

    // Where the walkthrough stops today, held exactly there.
    //
    // The `random` opcode calls GENERAL_GET_RANDOM_INT, which open-abap-core
    // does not implement, so the first dice roll closes the channel with
    // CX_SY_DYN_CALL_ILLEGAL_FUNC — and the first dice roll in MiniZork is
    // the troll. Until that function module exists the walkthrough cannot
    // finish, so this test asserts the shape of the stop rather than
    // pretending it is not there: a different command, a different
    // exception, or fewer commands surviving is a new defect and turns it
    // red. When the gap is filled the else branch takes over and demands the
    // whole script.
    if (answers.died === undefined) {
      expect(answers.out.length).toBe(steps.length);
    } else {
      expect(answers.stoppedAt).toBe("kill troll with sword");
      expect(answers.died).toContain("CX_SY_DYN_CALL_ILLEGAL_FUNC");
      expect(answers.out.length).toBeGreaterThan(20);
    }
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});

// The launchpad carries the two that are not UI5.
//
// Travels, Bookings, Flight analytics and SEGW are components the shell
// loads. Vivid Vibes and Zork are pages an ABAP class writes, served from
// the ICF path by the same runtime, and they sit on the same launchpad
// because that is what a launchpad is for: pointing at a service, whatever
// is behind it.
//
// What this asserts is the wiring — the tiles are there and their targets
// name the ICF paths. It deliberately does not drive the shell to open one:
// a ushell tile is a composite that resists clicking from a test, and intent
// navigation through the sandbox took as long as it felt like on a cold
// profile, so an end-to-end assertion here would have been a flaky way of
// proving something two other tests already prove deterministically — that
// the Zork page connects and plays, and that the o4d media are served.
test("the launchpad carries the ABAP-served demos, wired to the ICF paths", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stg-preview-flp-"));
  const context = await chromium.launchPersistentContext(profile, {headless: true, serviceWorkers: "allow"});
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3031/index.html?stay=1");
    await controlled(page);

    await page.goto("http://localhost:3031/app/flp.html", {waitUntil: "domcontentloaded", timeout: 60000});
    await expect(page.getByText("a Z-machine, in ABAP")).toBeVisible({timeout: 60000});
    await expect(page.getByText("a demo, in ABAP")).toBeVisible({timeout: 60000});

    // the tile targets, read off the page the shell actually booted from.
    // The shell consumes sap-ushell-config during startup, so only the group
    // definition is still there to read; the application URLs are asserted
    // against the built file below, which is the artefact that ships.
    const targets = await page.evaluate(() =>
      globalThis["stg-launchpad-groups"][0].tiles.map((t) => t.properties.targetURL));
    expect(targets).toContain("#Zork-play");
    // the repository as a tile, and the QR image tile beside it (the shell
    // rewrites an image tile's target, so only the count says it is there)
    expect(targets).toContain("#Source-open");
    expect(targets).toContain("#VividVibes-play");
    // six apps and the Source tile; the QR image tile beside it is listed
    // by the shell on one machine and not on another, so it is not counted
    expect(targets).toContain("#Lsd-play");
    expect(targets.length).toBeGreaterThanOrEqual(8);

    const {readFile} = await import("node:fs/promises");
    const {fileURLToPath} = await import("node:url");
    const shipped = await readFile(fileURLToPath(new URL("../../build/preview/app/flp.html", import.meta.url)), "utf8");
    expect(shipped).toContain('url: "../sap/bc/zork"');
    expect(shipped).toContain('url: "../sap/bc/zo4d_demo"');
  } finally {
    await context.close();
    await rm(profile, {recursive: true, force: true});
  }
});
