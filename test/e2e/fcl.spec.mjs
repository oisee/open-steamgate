import {test, expect} from "@playwright/test";

test.use({actionTimeout: 15000});

test("Travels opens list, object and booking in three real FCL columns", async ({page}) => {
  await page.setViewportSize({width: 1680, height: 1000});
  await page.goto("/app/index.html");
  const begin = page.locator(".sapFFCLColumnBegin");
  const mid = page.locator(".sapFFCLColumnMid");
  const end = page.locator(".sapFFCLColumnEnd");
  await expect(begin).toBeVisible();
  await begin.locator("tr.sapMListTblRow", {hasText: "Berlin to Copenhagen"}).click();
  await expect(mid.getByText("Ada Lovelace", {exact: true})).toBeVisible();
  await expect(begin).toBeVisible();
  await mid.getByText("Ada Lovelace", {exact: true}).click();
  await expect(end).toBeVisible();
  await expect(end).toContainText("Ada Lovelace");
  await expect(begin).toBeVisible();
  await expect(mid).toBeVisible();
  await end.getByRole("button", {name: "Full Screen", exact: true}).click();
  await expect(end).toBeVisible();
  await expect(begin).not.toBeVisible();
  await expect(mid).not.toBeVisible();
  await end.getByRole("button", {name: "Exit Full Screen", exact: true}).click();
  await expect(begin).toBeVisible();
  await expect(mid).toBeVisible();
  await end.getByRole("button", {name: "Close", exact: true}).click();
  await expect(mid.getByText("Ada Lovelace", {exact: true})).toBeVisible();
  await expect(end).not.toBeVisible();
});

test("FCL keeps the current object usable on a phone-sized screen", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/app/index.html");
  const begin = page.locator(".sapFFCLColumnBegin");
  const mid = page.locator(".sapFFCLColumnMid");
  const end = page.locator(".sapFFCLColumnEnd");
  // Responsive tables hide the description on phones, but keep the key.
  await begin.getByRole("gridcell", {name: "T0001", exact: true}).click();
  await expect(mid).toBeVisible();
  await expect(begin).not.toBeVisible();
  await mid.getByRole("gridcell", {name: "B001", exact: true}).click();
  await expect(end).toBeVisible();
  await expect(end).toContainText("Ada Lovelace");
  await expect(mid).not.toBeVisible();
  await page.goBack();
  await expect(mid).toBeVisible();
});
