import {test, expect} from "@playwright/test";

// A click, in a browser, in abapGit's markup rendered through
// cl_gui_html_viewer, comes back into ABAP as sapevent (backlog G.2).
//
// The wire test (test/sapevent.mjs) plays the browser by hand; this one lets
// a real browser do it: the document sits in a sandboxed iframe that may
// submit forms and replace the top page on a user's click, and nothing else.
// What comes back is what abapGit's own event class made of the click.
const PATH = "/sap/bc/gui/sap/its/webgui/sapevent/";

test("sapevent: a repository's anchor, clicked in the frame, reaches abapGit's event class", async ({page}) => {
  await page.goto(PATH);
  const frame = page.frameLocator('iframe[title="HTML viewer"]');
  // abapGit's anchor arrived as a button of a form, and its text is the label
  const repo = frame.getByRole("button", {name: "open-abap-gui"});
  await expect(repo).toBeVisible();
  await repo.click();
  await page.waitForURL(new RegExp(PATH.replaceAll("/", "\\/") + "$"));

  const trace = JSON.parse(await page.locator("body").innerText());
  expect(trace.dispatched).toBe(true);
  expect(trace.action).toBe("select");
  expect(trace.getdata).toBe("key=000000000002");
  expect(trace.query).toEqual({KEY: "000000000002"});
});

test("sapevent: the New Online Repository form, filled in and submitted in the frame", async ({page}) => {
  await page.goto(PATH);
  const frame = page.frameLocator('iframe[title="HTML viewer"]');
  await frame.locator("#url").fill("https://github.com/oisee/open-steamgate.git");
  await frame.locator("#package").fill("$OSD");
  await frame.locator("#display_name").fill("open steamgate & friends");
  await frame.getByRole("button", {name: "Create Online Repo"}).click();
  await page.waitForURL(/sapevent=add-repo-online/);

  const trace = JSON.parse(await page.locator("body").innerText());
  expect(trace.dispatched).toBe(true);
  expect(trace.action).toBe("add-repo-online");
  // what the browser posted, as the frontend hands it to ABAP: the text as
  // typed, the pair delimiters escaped, none of the transport's fields
  expect(trace.postdata.join("")).toBe(
    "url=https://github.com/oisee/open-steamgate.git&package=$OSD&branch_name=&display_name=open steamgate %26 friends&folder_logic=PREFIX",
  );
  // and what abapGit reads out of it
  expect(trace.form.URL).toBe("https://github.com/oisee/open-steamgate.git");
  expect(trace.form.PACKAGE).toBe("$OSD");
  expect(trace.form.DISPLAY_NAME).toBe("open steamgate & friends");
});

test("sapevent: a side action's own submit button is its own event", async ({page}) => {
  await page.goto(PATH);
  const frame = page.frameLocator('iframe[title="HTML viewer"]');
  await frame.locator("#url").fill("https://example.org/r.git");
  // the picker beside the branch field posts the same form to choose-branch
  await frame.locator('input[formaction*="choose-branch"]').click();
  await page.waitForURL(/sapevent=choose-branch/);

  const trace = JSON.parse(await page.locator("body").innerText());
  expect(trace.action).toBe("choose-branch");
  expect(trace.form.URL).toBe("https://example.org/r.git");
});
