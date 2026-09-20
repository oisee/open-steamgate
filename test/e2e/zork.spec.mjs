import {test, expect} from "@playwright/test";
import {shortRoute} from "./fixtures/zork-short-route.mjs";
import {readFileSync} from "node:fs";

// E.4: the console did not fit its box. Alice, from the launchpad tile: a
// long line runs past the right edge of the terminal frame instead of
// wrapping inside it.
//
// The cause was arithmetic, not CSS opinion. xterm renders `cols` x `rows`
// at whatever the font measures and the element only clips it — 100 columns
// of 16px Courier is about 960px, in a box declared 820px wide. Measured
// before the fix: the drawn terminal stuck out **127px** past the drawn
// border.
//
// So the assertion is the one the complaint was about: the terminal is
// inside the frame. Not "the CSS says inline-block", which would pass a
// stylesheet that happens to be wrong — the question is where the two boxes
// actually are, and only a layout can answer it.
test("the Zork console fits inside its frame", async ({page}) => {
  await page.goto("/sap/bc/zork/");
  await expect(page.locator(".xterm-screen")).toBeVisible({timeout: 30000});
  await expect(page.locator(".xterm-viewport")).toHaveCSS("overflow-y", "auto");

  const fit = await page.evaluate(() => {
    const frame = document.getElementById("terminal-container");
    const screen = document.querySelector(".xterm-screen");
    const f = frame.getBoundingClientRect();
    const s = screen.getBoundingClientRect();
    return {
      right: Math.round(s.right - f.right),
      bottom: Math.round(s.bottom - f.bottom),
      left: Math.round(f.left - s.left),
      top: Math.round(f.top - s.top),
      width: Math.round(s.width),
    };
  });

  expect(fit.width, "the terminal drew something").toBeGreaterThan(200);
  for (const [side, over] of Object.entries(fit)) {
    if (side === "width") continue;
    expect(over, `the terminal sticks out ${over}px past the frame on the ${side}`).toBeLessThanOrEqual(0);
  }
});

test("the prompt is a line with the cursor on it, not a line of its own", async ({page}) => {
  // the other half of E.4. It was a consequence of the first: with the
  // terminal wider than its box, a long line wrapped where nobody could see
  // it and the prompt appeared to stand alone.
  await page.goto("/sap/bc/zork/");
  await expect(page.locator("#statusText")).toHaveText(/Connected/, {timeout: 60000});
  await expect(page.locator(".xterm-rows")).toContainText("small mailbox", {timeout: 60000});

  const prompt = await page.evaluate(() => {
    // walk the container's children rather than match a selector shape: the
    // row markup differs between xterm's renderers, and a selector that is
    // right for one of them reads as "no rows" for the other — which is an
    // empty list that looks like an answer
    const container = document.querySelector(".xterm-rows");
    const rows = [...(container?.children ?? [])]
      .map((d) => d.textContent.replace(/\u00a0/g, " ").trimEnd())
      .filter((r) => r.trim() !== "");
    return rows[rows.length - 1] ?? "";
  });
  expect(prompt, "the last line the machine wrote is its prompt").toMatch(/^>\s*$/);
});

test("the page replays a fresh Zork session through the visible terminal", async ({page}) => {
  await page.goto("/sap/bc/zork/");
  const terminal = page.locator(".xterm-rows");
  const start = page.getByRole("button", {name: "Replay short route"});
  const progress = page.locator("#replay-progress");
  await expect(page.locator("#statusText")).toHaveText(/Connected/, {timeout: 60000});
  await expect(start).toBeEnabled({timeout: 60000});

  expect(await page.evaluate(() => replaySteps)).toEqual(shortRoute.map((step) =>
    ({command: step.command, expect: step.responseMarker})));

  // Change the old session first: a replay that reused it would answer that
  // the mailbox is already open, instead of passing the first route check.
  await page.locator("#terminal").click();
  await page.keyboard.type(shortRoute[0].command);
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(shortRoute[0].responseMarker, {timeout: 60000});
  await expect(start).toBeEnabled({timeout: 60000});

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(/fresh game.*discards your current session/i);
    await dialog.accept();
  });
  await start.click();
  await expect(progress).toHaveText(/Replay complete: 2 commands verified/, {timeout: 60000});
  await expect(terminal).toContainText(shortRoute[1].responseMarker, {timeout: 60000});
  await expect(start).toBeEnabled();
  await expect(page.getByRole("button", {name: "Cancel replay"})).toBeDisabled();

  // Returning to manual input must use the same live session and UI path.
  await page.locator("#terminal").click();
  await page.keyboard.type("open mailbox");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(/already open/i);
});

test("declining replay preserves the current game", async ({page}) => {
  await page.goto("/sap/bc/zork/");
  const start = page.getByRole("button", {name: "Replay short route"});
  await expect(start).toBeEnabled({timeout: 60000});
  await page.locator("#terminal").click();
  await page.keyboard.type("open mailbox");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(shortRoute[0].responseMarker);
  page.once("dialog", (dialog) => dialog.dismiss());
  await start.click();
  await page.locator("#terminal").click();
  await page.keyboard.type("open mailbox");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(/already open/i);
  await expect(page.locator("#replay-progress")).not.toContainText("Replay complete");
});

test("cancelling replay reconnects a fresh manually playable session", async ({page}) => {
  await page.goto("/sap/bc/zork/");
  const start = page.getByRole("button", {name: "Replay short route"});
  await expect(start).toBeEnabled({timeout: 60000});
  page.once("dialog", (dialog) => dialog.accept());
  // Cancel in the same browser task, before even a fast local APC can finish
  // the route. Both real button listeners and the real reconnect still run.
  await page.evaluate(() => {
    document.getElementById("replay-start").click();
    document.getElementById("replay-cancel").click();
  });
  await expect(page.locator("#replay-progress")).toContainText("Replay cancelled");
  await expect(start).toBeEnabled({timeout: 60000});
  await expect(page.getByRole("button", {name: "Cancel replay"})).toBeDisabled();
  await page.locator("#terminal").click();
  await page.keyboard.type("open mailbox");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(shortRoute[0].responseMarker);
  await expect(page.locator("#replay-progress")).not.toContainText("Replay complete");
});

test("SPEEDRUN replays every command from the packaged SMW0 script through APC", async ({page, request}) => {
  test.setTimeout(150000);
  const script = readFileSync("packs/zork/games/zork-mini-speedrun-txt.w3mi.data.txt", "utf8");
  const commands = script.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  expect(commands.length).toBeGreaterThan(30);
  const resource = await request.get("/sap/bc/zork/speedrun.txt");
  expect(resource.status()).toBe(200);
  expect(await resource.text()).toBe(script);
  const sent = [];
  page.on("websocket", (socket) => {
    if (socket.url().includes("/zapc_zork")) socket.on("framesent", ({payload}) => sent.push(String(payload)));
  });
  await page.goto("/sap/bc/zork/");
  const start = page.getByRole("button", {name: "Replay SPEEDRUN", exact: true});
  await expect(start).toBeEnabled({timeout: 60000});
  page.once("dialog", (dialog) => dialog.accept());
  await start.click();
  await expect(page.locator("#replay-progress")).toContainText(`${commands.length} commands replayed`, {timeout: 120000});
  expect(sent).toEqual(commands);
  await expect(page.locator(".xterm-rows")).toContainText(/Your score is/i);
  await expect(start).toBeEnabled();
});
