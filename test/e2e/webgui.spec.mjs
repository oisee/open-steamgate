import {test, expect} from "@playwright/test";

// SAP Easy Access, in a browser.
//
// The wire test already knows the HTML is right; what a browser adds is that
// the screen behaves like the screen it imitates: the folders fold, a node
// takes you to the thing it names, and the command field is a second way to
// the same place. Nothing here asserts a status code on its own.
const WEBGUI = "/sap/bc/gui/sap/its/webgui/";

test("easy access: the menu renders, and a node goes where it says", async ({page}) => {
  await page.goto(WEBGUI);

  // the title bar and the image panel down the right-hand side
  await expect(page.locator(".title")).toContainText("SAP Easy Access");
  const art = page.locator(".art");
  await expect(art).toBeVisible();
  const box = await art.boundingBox();
  expect(box.width).toBeGreaterThan(100);
  // the panel is as tall as the screen: it is the bulge down the side, not a picture in a corner
  expect(box.height).toBeGreaterThan(400);

  // the top two levels stand open, the rest is folded
  await expect(page.locator('details:has(> summary[data-node="MENU"])')).toHaveAttribute("open", "");
  const odata = page.locator('details:has(> summary[data-node="ODATA"])');
  await expect(odata).toBeVisible();
  await expect(odata).not.toHaveAttribute("open", "");

  // open it, and the services of this system are inside
  await page.locator('summary[data-node="ODATA"]').click();
  await expect(odata).toHaveAttribute("open", "");
  const node = page.locator('[data-node="ZSTG_DEMO_SRV"]');
  await expect(node).toBeVisible();
  await expect(node).toContainText("travels and bookings");

  // and it goes to the service it names
  await node.click();
  await page.waitForURL(/\/sap\/opu\/odata\/sap\/ZSTG_DEMO_SRV\/$/);
  await expect(page.locator("body")).toContainText("TravelSet");
});

test("easy access: the command field is the second way in", async ({page}) => {
  await page.goto(WEBGUI);

  // a name the tree knows, typed rather than clicked
  await page.locator("input.cmd").fill("zork");
  await page.locator("input.cmd").press("Enter");
  await page.waitForURL(/\/sap\/bc\/zork$/);

  // a name it does not know comes back as the message SAP puts in the status bar
  await page.goto(WEBGUI);
  await page.locator("input.cmd").fill("ZNOSUCHTHING");
  await page.locator("input.cmd").press("Enter");
  await expect(page.locator("#msg")).toContainText("Transaction ZNOSUCHTHING does not exist");

  // and the one transaction node says what it is: a thing to be run, once
  // running one is real (docs/webgui.md)
  await page.locator("input.cmd").fill("ZABAPGIT");
  await page.locator("input.cmd").press("Enter");
  await expect(page.locator("#msg")).toContainText("not runnable yet");
  await expect(page.locator('[data-node="ZABAPGIT"]').first()).toBeVisible();
});
