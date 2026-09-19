import {test, expect} from "@playwright/test";

// The arrow keys in the Easy Access tree (backlog G.1).
//
// `test/webgui.mjs` can only assert that the page *contains* the word
// ArrowRight, which is a check on a string and not on a behaviour -- the
// shape this tree spent a day removing from its own suites. So the keys are
// pressed here, by a browser, and what is asserted is where the focus went
// and whether the folder opened.
//
// Both defects this file would have caught were found by pressing the keys
// by hand and neither was visible by reading:
//   - Left from a **leaf** went nowhere, because the parent of a leaf and
//     the parent of a folder are not one expression;
//   - Down from a closed folder walked into its hidden children, because
//     visibility was read off `offsetParent`, which in Chromium stays
//     non-null for the contents of a folded `<details>`.
const PATH = "/sap/bc/gui/sap/its/webgui";

/** what has the focus, and whether it is an open or a closed folder */
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (a === null) return {text: "", kind: "none"};
  const kind = a.tagName === "SUMMARY" ? (a.parentNode.open ? "open" : "closed") : "leaf";
  return {text: a.textContent.trim().slice(0, 24), kind};
});

test("the tree walks on the arrow keys, and Down steps over a folded folder", async ({page}) => {
  await page.goto(PATH);
  await page.evaluate(() => document.querySelector(".tree summary").focus());
  expect(await focused(page)).toMatchObject({text: "Favorites", kind: "open"});

  // Left on an open folder closes it; it does not move
  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toMatchObject({text: "Favorites", kind: "closed"});

  // and Down then goes to the next **visible** row, not into what was folded
  await page.keyboard.press("ArrowDown");
  const next = await focused(page);
  expect(next.kind).toBe("open");
  expect(next.text).not.toContain("Fiori launchpad");
});

test("Right opens a folder and then steps into it, Left from a leaf goes out", async ({page}) => {
  await page.goto(PATH);
  // a folder that starts folded: the third level is not open by default
  await page.evaluate(() => {
    const shut = [...document.querySelectorAll(".tree details.fld")]
      .find((d) => d.open === false && d.closest("details.fld[open]") !== null);
    shut.querySelector("summary").focus();
  });
  expect((await focused(page)).kind).toBe("closed");

  await page.keyboard.press("ArrowRight");
  const folder = await focused(page);
  expect(folder.kind).toBe("open");

  // pressed again it does not toggle back: it goes in
  await page.keyboard.press("ArrowRight");
  const child = await focused(page);
  expect(child.kind).toBe("leaf");

  // and Left from a leaf goes to the folder it is in, without closing it.
  //
  // **The folder is named**, not merely described as open. Asserting only
  // `kind: "open"` passed against the defect this test exists for: the
  // broken version climbed one level too far and landed on the grandparent,
  // which is open as well. An assertion next to the property is not the
  // property, and this one was written that way first (2026-09-19).
  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toEqual({text: folder.text, kind: "open"});
});
