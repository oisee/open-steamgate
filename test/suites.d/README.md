# Placing integration suites

Add every new `test/*.mjs` file containing a top-level `describe(` to one fragment's `files` array. Named groups such as `groups.packaging` need an explicit CI gate. Run `node tools/osd-suites.mjs --check` after adding a suite: an unlisted file fails the check and prints a suggested fragment.

The table below routes by **filename prefix**, without `test/`. A trailing `.` matches the exact stem and extension (for example, `amdp.` matches `amdp.mjs`). Use the longest matching prefix. If two prefixes of equal length match, choose the alphabetically first fragment filename. A name with no match goes in `infra-misc.json`. The table is implemented in `SUITE_FRAGMENTS` in `tools/osd-suites.mjs`; update both places when a new family needs its own rule. Feature ownership may justify a different fragment; document that exception beside the entry.

| Filename prefixes | Fragment |
| --- | --- |
| `adt-`, `http-codelens` | `adt.json` |
| `amdp-`, `amdp.`, `ir-`, `sqlscript-`, `hana-`, `reserved-words` | `amdp-sqlscript.json` |
| `apc-`, `amc.`, `dialog-step`, `pages-push`, `osd-apc`, `osd-icf-apc` | `apc-daemons.json` |
| `cds-`, `analytics`, `ddic-` | `cds-sadl.json` |
| `batch-inserts`, `conformance`, `database-`, `db-migrate`, `demo-data`, `gateway-`, `http-case`, `mocha.`, `reference-`, `replay-`, `rfc-`, `sapevent`, `se16`, `seed-`, `sql-`, `sqlite-`, `store-`, `transaction`, `write-boundary` | `gateway-odata.json` |
| `generation-`, `osd-`, `osgo-`, `preview-`, `stg-`, `type-`, `unit-run`, `warm.`, `xref-` | `gogen-osgo.json` |
| `osd-dataset`, `osd-suites` | `infra-misc.json` |
| `batch-runs`, `job-`, `jobs-`, `osd-job`, `osd-queue`, `telegram-` | `jobs.json` |
| `bsp-`, `editor.`, `flp-`, `generated-`, `osd-bsp`, `pages-index`, `segw-`, `segw.`, `webgui` | `segw.json` |
| `ci-vsix`, `release-`, `third-party-`, `vsix-`, `vscode-` | `vscode.json` |
| No matching prefix | `infra-misc.json` |

For example, `osd-job-next.mjs` goes to `jobs.json` rather than the broader `osd-` rule for `gogen-osgo.json`. `osd-dataset-next.mjs` goes to `infra-misc.json`.
