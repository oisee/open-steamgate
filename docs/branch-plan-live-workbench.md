# Live workbench: activation and source history

Branch: `feat/live-workbench-activation` (from `main`, 2026-09-21).

The product goal is a short in-system edit loop, not a replica of SE80's UI:
open code, save an inactive edit, check with line diagnostics, activate, run a
focused test, and inspect the result. ADT/abap-fs and the OSD editor must use
the same object store and activation rules. A SEGW model/request client can
join this workbench later; it must not create a second write path.

## This branch: activation correctness

1. Keep a saved object inactive while its build and runtime publication run.
   A failed build or recycle must not make the editor report an active version.
2. Tie the check verdict to the exact source revision. If an editor saves
   during the build, keep the new edit inactive and ask for a fresh check.
   An ADT request naming several objects must not clear only some of them.
3. Apply the rule to ADT activation, the in-system store destination, and the
   filesystem dev loop. Add regression tests for failed publication and a
   concurrent save; run the focused suites and the relevant integration gate.

This is not a claim that arbitrary concurrent writes produce a transactionally
consistent generated build. That needs a separate immutable build-input
snapshot or write serialization, with a test that changes inputs mid-build.

## Next visible slice: Git-backed history

The host repository is the source-history layer. Show branch/commit and the
active build hash separately; expose diff between working/inactive source,
active source, and a selected Git revision. Save and Activate never silently
commit or push. Restore must create an inactive edit and follow the same
Check/Activate path. Before implementation, define authorization and behavior
for dirty worktrees, detached HEAD, concurrent editors, and packaged images
without a `.git` directory.

After that, make a class + ABAP Unit run pleasant end-to-end in the workbench;
then add a read/test SEGW client. A full SE80 clone and a DIAG/RFC transport
rewrite are outside this branch.
