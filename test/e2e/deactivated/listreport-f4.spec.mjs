// Deactivated 2026-09-26 (Alice): the F4 value-help check failed at random
// on unrelated PRs (UI5 renders the dialog title twice, the second copy for
// screen readers). Kept here, out of the run (playwright.config testIgnore),
// until it is fixed properly; the locator fix of #121 is already applied.
import {test, expect} from "@playwright/test";
// the port of the gateway under test: STG_PORT, as test/start.mjs reads it, so sessions do not collide on 3030
const PORT = process.env.STG_PORT ?? 3030;

// A Fiori Elements V2 list report (SAPUI5 from the CDN) against the
// transpiled DPC. Needs network access for the UI5 runtime.
test("F4 on Status: the value help dialog reads StatusVHSet, searches it, and its pick becomes $filter", async ({page}) => {
  const requests = [];
  page.on("request", (req) => {
    const text = req.url() + " " + (req.postData() || "");
    if (text.includes("/sap/opu/odata/sap/")) {
      requests.push(text.replace(/\r?\n/g, " "));
    }
  });
  await page.goto("/app/index.html");
  // Common.Text + TextArrangement: the column shows the text first
  await expect(page.getByText("Accepted (A)").first()).toBeVisible();

  const status = page.getByLabel(/^Status/).first();
  await status.focus();
  await page.keyboard.press("F4");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Cancelled")).toBeVisible();
  await expect(dialog.getByText("Accepted")).toBeVisible();
  expect(requests.some((r) => /StatusVHSet\?/.test(r) && r.includes("$select=Status%2cText"))).toBe(true);

  // the dialog's own search goes to the DPC as iv_search_string
  const search = dialog.getByRole("searchbox").or(dialog.getByPlaceholder("Search")).first();
  await search.fill("cancel");
  await search.press("Enter");
  await expect(dialog.getByText("Items (1)")).toBeVisible();
  expect(requests.some((r) => /StatusVHSet\?/.test(r) && r.includes("search=cancel"))).toBe(true);

  // pick the row (keyboard: Space on its cell toggles the selection, then OK)
  // and the filter bar fires $filter
  // after the search the table holds one row: Cancelled
  const pick = dialog.getByRole("gridcell", {name: "Click to Select"}).first();
  await pick.focus();
  await page.keyboard.press("Space");
  // the visible toolbar title, not the screen-reader copy UI5 also renders
  // (class sapUiInvisibleText): two matches fail a strict locator at random,
  // depending on whether the second one is in the DOM yet
  await expect(dialog.locator("span:not(.sapUiInvisibleText)", {hasText: "No Items or Conditions Selected"})).toBeHidden();
  // The CDN dialog currently leaves OK open after focus()+Enter; click still
  // exercises the chosen value and the resulting OData filter.
  await dialog.getByRole("button", {name: "OK"}).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", {name: "Go"}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Aarhus to Odense")).toBeVisible();
  await expect(page.getByText("Berlin to Copenhagen")).toBeHidden();
  expect(requests.some((r) => /\$filter=Status eq 'X'/.test(decodeURIComponent(r)))).toBe(true);
});
