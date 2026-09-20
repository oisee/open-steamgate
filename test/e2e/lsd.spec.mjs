import {test, expect} from "@playwright/test";

test("LSD preloads but starts only with Play", async ({page}) => {
  await page.addInitScript(() => {
    window.audioPlayCalls = 0;
    HTMLMediaElement.prototype.play = function () {
      window.audioPlayCalls++;
      return Promise.resolve();
    };
  });
  const audioRequest = page.waitForRequest(r => r.url().includes("?audio"));
  await page.goto("/sap/bc/lsd");
  await audioRequest;
  const play = page.getByRole("button", {name: /Play/});
  await expect(play).toBeEnabled({timeout: 60000});
  await expect(page.locator("audio")).toHaveAttribute("preload", "auto");
  await page.locator("#status").click();
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => ({playing, calls: window.audioPlayCalls})))
    .toEqual({playing: false, calls: 0});
  await play.click();
  await expect(page.getByRole("button", {name: /Stop/})).toBeVisible();
  expect(await page.evaluate(() => window.audioPlayCalls)).toBe(1);
  await page.getByRole("button", {name: /Stop/}).click();
  await page.locator("#status").click();
  expect(await page.evaluate(() => ({playing, calls: window.audioPlayCalls})))
    .toEqual({playing: false, calls: 1});
});
