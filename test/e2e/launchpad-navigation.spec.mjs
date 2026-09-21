import {test, expect} from "@playwright/test";
import {registerLaunchpadNavigationTests} from "./launchpad-navigation.shared.mjs";

async function openLaunchpad(page) {
  await page.goto("/app/flp.html");
  await page.locator(".sapMGT").first().waitFor({timeout: 60_000});
}

registerLaunchpadNavigationTests({test, expect, openLaunchpad});

test("launchpad: keeps an unavailable capability visible and disabled", async ({page}) => {
  await openLaunchpad(page);
  const shellTile = page.locator(".sapUshellTile", {hasText: "AMDP sandbox"}).first();
  const tile = shellTile.locator(".sapMGT");
  await expect(shellTile).toBeVisible();
  await expect(tile).toHaveClass(/sapMGTStateDisabled/);
  await expect(tile).toHaveAttribute("aria-disabled", "true");
  await expect(tile.locator(".sapMTileCntFooterTextColorError")).toContainText("no SQLScript engine here");
  await expect(shellTile.locator("a")).toHaveCount(0);
});
