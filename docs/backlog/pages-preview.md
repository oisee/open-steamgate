
## Deploying: the i7 follows Pages

Alice's standing rule is that a finished milestone goes to both addresses --
the i7 showcase and GitHub Pages -- **from one commit**, each verified by
reading what it actually serves. Two attempts on 2026-09-19 failed the "one
commit" half, and not through carelessness: Pages is triggered automatically
by a push, the i7 is built by hand and takes minutes, and a second push
during the build leaves them on different commits. Chasing a moving target
does not converge.

So the order is fixed rather than coordinated: **Pages first, the i7 after
it, from the commit Pages published.** When a preview deployment run goes
green, rebuild the release from exactly that commit and restart the i7. No
asking anybody to hold pushes, and the rule holds however often the tree
moves.

Verification stays what it was, on both: fetch the served page (or the
published `sw.js`) and read in it the thing that was supposed to change. A
green workflow is not a deployment, and a build command exiting 0 is not one
either.

And one check that makes a divergence visible **without anybody's word for
it** (fable-osd): both targets print their generation in the footer, so the
statement to make is not "I built them from the same commit" but **"both
pages show the same generation"**. Anyone can check that, including the
person who did not do the deploying.

### Pages preview: build on releases, not on every merge (2026-09-30)

Today `preview.yml` runs on every pull request (sql.js build + browser check + `pr-<n>/`, about 4.6 min) and on every
push to main (full build incl. DuckDB-Wasm/Portable AMDP, about 9.2 min) and republishes `main/` on each merge; the
browser checks gate the publish, so a broken build does not replace the page, but the public preview moves with
every merge and the minutes are spent each time. Proposal (Alice): publish the public `main/` preview from release
tags (`vscode-v*`, prerelease included) or a manual dispatch, so the preview always matches a released version;
PR previews opt-in (a `preview` label) instead of on every PR. Keep the browser checks as the publish gate. Measure
the CI minutes saved over a week before and after.
