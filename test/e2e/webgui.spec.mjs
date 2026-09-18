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
  await expect(page.locator(".title")).toContainText("Easy Access");
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

  // The one transaction node this class types out. Running a transaction is
  // real since G.3, and this one is the seat abapGit will sit in: the screen
  // has the node and no *.tran.xml backs it, so it says what is missing
  // rather than "does not exist" about something visibly in the menu.
  await page.locator("input.cmd").fill("ZABAPGIT");
  await page.locator("input.cmd").press("Enter");
  await expect(page.locator("#msg")).toContainText("no zabapgit.tran.xml in this tree");
  await expect(page.locator("#msg")).not.toContainText("does not exist");
  await expect(page.locator('[data-node="ZABAPGIT"]').first()).toBeVisible();
});

test("easy access: the picture is drawn in the page and fetches nothing", async ({page}) => {
  const requests = [];
  page.on("request", (one) => requests.push(one.url()));
  await page.goto(WEBGUI);

  // the rain scene is there and the lone bead is not (Alice, 2026-09-18)
  await expect(page.locator("svg.artscene")).toBeVisible();
  await expect(page.locator("svg.artdrop")).toHaveCount(0);
  // it stretches with the panel rather than being scaled and cropped, the way
  // the picture on the real screen does (Alice: "stretch like SAP")
  await expect(page.locator("svg.artscene")).toHaveAttribute("preserveAspectRatio", "none");
  // and the screen still makes no second request for any of it
  expect(requests.filter((u) => /\.(png|jpe?g|gif|svg)$/.test(u) && !u.endsWith("/osg.svg"))).toHaveLength(0);
});

test("easy access: the boundary is pulled, and stepped when it is clicked", async ({page}) => {
  await page.goto(WEBGUI);

  const tree = page.locator(".tree");
  const art = page.locator(".art");
  const ridge = await page.locator(".split").boundingBox();
  const before = await tree.boundingBox();
  const artBefore = await art.boundingBox();

  // a pull, anywhere along the boundary. This is the gesture everybody makes
  // over a col-resize cursor and the only reason this screen carries a
  // script: a browser draws its own resize handle in one corner and there is
  // no way to stretch that handle down the whole edge.
  await page.mouse.move(ridge.x + 4, ridge.y + ridge.height / 2);
  await page.mouse.down();
  await page.mouse.move(ridge.x + 4 - 250, ridge.y + ridge.height / 2, {steps: 10});
  await page.mouse.up();

  const after = await tree.boundingBox();
  const artAfter = await art.boundingBox();
  expect(after.width).toBeLessThan(before.width - 200);
  // and what the tree gave up the image panel took
  expect(artAfter.width).toBeGreaterThan(artBefore.width + 200);
});

// The screen carried no script at all for a week, on purpose, so the one it
// carries now has to earn its place: everything the page does must still work
// without it. That is what this asserts - not a count of script tags, which
// never said anything about whether the page depended on them.
test.describe("with scripting switched off", () => {
  test.use({javaScriptEnabled: false});

  test("easy access: the boundary still steps and the picture still hides", async ({page}) => {
    await page.goto(WEBGUI);
    const tree = page.locator(".tree");
    const ridge = await page.locator(".split").boundingBox();
    const before = (await tree.boundingBox()).width;

    await page.mouse.click(ridge.x + 4, ridge.y + ridge.height * 0.8);
    expect((await tree.boundingBox()).width).not.toBe(before);

    await page.locator("a.splithide").click();
    await expect(page.locator(".art")).toBeHidden();
  });
});

test("easy access: the menu bar goes where it says, and says what it cannot do", async ({page}) => {
  await page.goto(WEBGUI);

  // it folds out on hover, in CSS
  const system = page.locator('.mi:has(> .mt:text-is("System"))');
  await expect(system.locator(".drop")).toBeHidden();
  await system.locator(".mt").hover();
  await expect(system.locator(".drop")).toBeVisible();

  // ... and on keyboard focus, which is the half a hover-only menu loses
  await page.locator('.mi:has(> .mt:text-is("Help")) .mt').focus();
  await expect(page.locator('.mi:has(> .mt:text-is("Help")) .drop')).toBeVisible();

  // Help > About: the generation and the identity, on a page of this class
  await page.locator('.drop a:text-is("About")').click();
  await page.waitForURL(/\/sap\/bc\/gui\/sap\/its\/webgui\/about$/);
  await expect(page.locator(".about")).toContainText("sy-sysid");
  await page.locator("a.back").click();
  await page.waitForURL(/\/sap\/bc\/gui\/sap\/its\/webgui\/$/);

  // System > Status opens the status app the tree points at
  await system.locator(".mt").hover();
  await page.locator('.drop a:text-is("Status")').click();
  await page.waitForURL(/#System-status$/);
});

test("easy access: the status bar says what the status service says", async ({page, request}) => {
  await page.goto(WEBGUI);

  const answer = await (await request.get("/sap/opu/odata/sap/ZOSD_STATUS_SRV/SystemSet?$format=json")).json();
  const row = answer.d.results[0];
  const bar = page.locator("#sysinfo");
  // the system and the work process, from the other end of the same system
  await expect(bar).toContainText(row.Sid);
  await expect(bar).toContainText(`(${String(row.Pid).trim()})`);
  await expect(bar).toContainText(row.HostKind);
  // and not the session number and client that used to be typed into the class
  await expect(bar).not.toContainText("(1)");
});
