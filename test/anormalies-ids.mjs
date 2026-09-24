import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Every entry of ANORMALIES.md is found by its id: npm run parked, the
// upstream dossier, commit messages and other entries all name it. Two
// branches that each carried an entry under the same id, with different
// text, would merge into a file with both, and nothing would say which one
// is meant (it nearly happened with the five httpc-* entries, 2026-09-24).
export function headingIds(text) {
  return [...text.matchAll(/^### ((?:ANOMALY|NOTE|DEBT)-\S+)/gm)].map((m) => m[1]);
}

describe("ANORMALIES.md: every entry id is unique", () => {
  it("the matcher sees an id once per heading", () => {
    const ids = headingIds("### ANOMALY-2026-01-01-a -- x\ntext\n### NOTE-2026-01-01-b — y\n#### ANOMALY-no\n");
    assert.deepEqual(ids, ["ANOMALY-2026-01-01-a", "NOTE-2026-01-01-b"]);
  });

  it("no id heads two entries", () => {
    const ids = headingIds(readFileSync("ANORMALIES.md", "utf8"));
    assert.ok(ids.length > 0, "no entry headings found");
    const seen = new Set();
    const twice = ids.filter((id) => seen.has(id) || !seen.add(id));
    assert.deepEqual(twice, [], `ids that head more than one entry: ${twice.join(", ")}`);
  });
});
