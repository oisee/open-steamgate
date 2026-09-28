# osg-demo: Test Explorer shows 0/0 for workspace tests

Reported after `git pull` in `oisee/osg-demo`: VS Code Testing lists system tests but no tests from the opened demo workspace. Reproduction from the demo session found `FOR TESTING` in both `ZOSD_DEMO_HELLO` and `ZCL_OSD_FLEET_REPORT`; `classifyTestPath(...)` returned `undefined` for both.

In `editors/vscode/lib.js`, `classifyTestPath` calls `startsWithSegment(rel, wlRel)` for a workspace layer. When the opened root equals `workspaceLayer.folder`, `wlRel` is `""`, and `startsWithSegment` explicitly returns `false` for an empty prefix. The tests therefore never reach the Workspace layers group. The existing test in `test/vscode-extension.mjs` covers a layer nested below the root, but not a layer whose folder is the root itself.

Exact reproduction on the then-current `osg-demo/main`: `classifyTestPath(root=osg-demo, absPath=<either .clas.testclasses.abap>, layers, workspaceLayers=[osg-demo])` returns `undefined` for both classes.

Next step: add a regression test for `osg-demo` opened as the VS Code folder, then handle the equal-root case in classification and verify both classes appear under `Workspace layers > osg-demo`. This requires a new build/install of the extension; pulling the demo repository alone cannot fix it. Keep this separate from the RISK LEVEL PR and the CI test-tier PR.
