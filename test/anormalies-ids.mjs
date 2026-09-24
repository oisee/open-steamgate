import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Every entry of ANORMALIES.md is found by its id: npm run parked, the
// upstream dossier, commit messages and other entries all name it. Two
// branches that each carried an entry under the same id, with different
// text, would merge into a file with both, and nothing would say which one
// is meant (it nearly happened with the five httpc-* entries, 2026-09-24).
export function headingIds(text) {
  // a heading inside a fenced code block is an example, not an entry
  const outside = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
  return [...outside.matchAll(/^### ((?:ANOMALY|NOTE|DEBT)-[A-Za-z0-9-]+)/gm)].map((m) => m[1]);
}

describe("ANORMALIES.md: every entry id is unique", () => {
  it("the matcher sees an id once per heading", () => {
    const ids = headingIds("### ANOMALY-2026-01-01-a -- x\ntext\n### NOTE-2026-01-01-b — y\n#### ANOMALY-no\n"
      + "```md\n### ANOMALY-2026-01-01-a -- quoted\n```\n### DEBT-2026-01-01-c: z\n");
    assert.deepEqual(ids, ["ANOMALY-2026-01-01-a", "NOTE-2026-01-01-b", "DEBT-2026-01-01-c"]);
  });

  it("no id heads two entries", () => {
    const ids = headingIds(readFileSync(new URL("../ANORMALIES.md", import.meta.url), "utf8"));
    assert.ok(ids.length > 0, "no entry headings found");
    const seen = new Set();
    const twice = ids.filter((id) => seen.has(id) || !seen.add(id));
    assert.deepEqual(twice, [], `ids that head more than one entry: ${twice.join(", ")}`);
  });
});
