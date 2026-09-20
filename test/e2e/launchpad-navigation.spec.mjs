import {test, expect} from "@playwright/test";
import {registerLaunchpadNavigationTests} from "./launchpad-navigation.shared.mjs";

async function openLaunchpad(page) {
  await page.goto("/app/flp.html");
  await page.locator(".sapMGT").first().waitFor({timeout: 60_000});
}

registerLaunchpadNavigationTests({test, expect, openLaunchpad});
