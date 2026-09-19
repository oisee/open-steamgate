import {test, expect} from "@playwright/test";

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
