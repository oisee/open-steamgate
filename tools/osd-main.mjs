// Whether this module is the one the command line named.
//
// **Why a helper and why it takes the name as a literal.** The form these
// tools used was
//
//   if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()))
//
// which is right for `node tools/osd-packs.mjs` and wrong inside the
// compiled binary, where **every bundled module shares one
// `import.meta.url`** (CLAUDE.md records this; it is why `bin/osd.mjs`
// restores renamed class names). In the binary that shared url ends in
// `/osd` and `process.argv[1]` is the binary itself, so the test is true in
// *every* module that carries it: the first such module to be evaluated runs
// its own `main()` and the binary becomes that tool. Measured 2026-09-19 --
// `build/osd doctor` printed "no packs: nothing in packs", because
// tools/osd-packs.mjs had been pulled into the graph and took the process
// over, passing "doctor" to itself as a directory.
//
// So the name is a literal: it cannot be derived from `import.meta.url`
// inside a bundle, since there is only one of those for the whole program.
import {basename} from "node:path";

export function runsAs(filename) {
  return basename(process.argv[1] ?? "") === filename;
}
