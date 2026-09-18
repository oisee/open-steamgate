import {test, expect} from "@playwright/test";

// A transaction, run from the Easy Access screen, in a real browser
// (backlog G.3, docs/webgui.md).
//
// test/transaction.mjs plays the browser by hand; this one lets Chromium do
// it, which is the part that cannot be faked: the document lives in a
// sandboxed iframe that may submit forms and replace the top page on a click,
// the typing goes into the field that is in that frame, and what comes back
// is the whole screen again with the transaction still in it.
const PATH = "/sap/bc/gui/sap/its/webgui/";

const frame = (page) => page.frameLocator('iframe[title="HTML viewer"]');

test("a transaction is entered from the command field and draws where the tree was", async ({page}) => {
  await page.goto(PATH);
  await page.fill('input[name="okcode"]', "ZOSD_NOTE");
  await page.press('input[name="okcode"]', "Enter");
  await page.waitForURL(/okcode=ZOSD_NOTE/);

  // the screen kept its own chrome around the transaction
  await expect(page.locator(".title")).toContainText("Easy Success");
  await expect(page.locator(".menu")).toContainText("Favorites");
  await expect(page.locator(".runhead")).toContainText("ZOSD_NOTE - Session notepad");
  await expect(page.locator("#msg")).toContainText("Session notepad started");
  // and the notepad is inside the viewer, not in the page
  await expect(frame(page).locator("h2")).toHaveText("Session notepad");
  await expect(page.locator("h2")).toHaveCount(0);
});

test("what is typed in one request is still there in the next", async ({page}) => {
  await page.goto(`${PATH}?okcode=ZOSD_NOTE`);
  await frame(page).locator("#note").fill("the first thing");
  await frame(page).getByRole("button", {name: "Add"}).click();
  await page.waitForURL(/\/tx\//);

  await expect(page.locator("#msg")).toContainText("1 in this session");
  await expect(frame(page).locator("ol.notes li")).toHaveText(["the first thing"]);

  // and again, in the screen the last click produced
  await frame(page).locator("#note").fill("the second thing");
  await frame(page).getByRole("button", {name: "Add"}).click();
  await expect(frame(page).locator("ol.notes li")).toHaveText(["the first thing", "the second thing"]);
  await expect(page.locator("#msg")).toContainText("2 in this session");
});

test("a second browser gets its own session and its own list", async ({browser}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const one = await first.newPage();
  const two = await second.newPage();

  await one.goto(`${PATH}?okcode=ZOSD_NOTE`);
  await two.goto(`${PATH}?okcode=ZOSD_NOTE`);

  await frame(one).locator("#note").fill("belongs to the first");
  await frame(one).getByRole("button", {name: "Add"}).click();
  await expect(frame(one).locator("ol.notes li")).toHaveText(["belongs to the first"]);

  // the second browser was open the whole time and saw none of it
  await expect(frame(two).locator("p.none")).toBeVisible();
  await frame(two).locator("#note").fill("belongs to the second");
  await frame(two).getByRole("button", {name: "Add"}).click();
  await expect(frame(two).locator("ol.notes li")).toHaveText(["belongs to the second"]);

  // and the first one is untouched by that
  await frame(one).locator("#note").fill("still the first");
  await frame(one).getByRole("button", {name: "Add"}).click();
  await expect(frame(one).locator("ol.notes li")).toHaveText(["belongs to the first", "still the first"]);

  await first.close();
  await second.close();
});

test("the way out of a transaction is back to the menu", async ({page}) => {
  await page.goto(`${PATH}?okcode=ZOSD_NOTE`);
  await page.locator(".runexit").click();
  await expect(page.locator(".tree .fld").first()).toBeVisible();
  await expect(page.locator("iframe[title='HTML viewer']")).toHaveCount(0);
});
