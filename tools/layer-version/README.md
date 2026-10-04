# Layer version requirements

A pack or workspace layer may declare `"osd": ">=0.6.1650"` in its
`osd-pack.json`. Only `>=x.y.z` is supported; absent means no requirement.
Versions compare numerically by major, minor, then patch. Invalid declarations
refuse rather than silently disabling the check.

`index.mjs` owns parsing, comparison, seed version stamping and the build check.
The shared builder's `prepare()` calls it before taking a lock, running a
generator or transpiling, including warm builds and cached generations.
Packs and explicit `OSD_LAYERS` are checked; the binary's `--layer` sets those
layers. A layer can name the manifest directory or a declared ABAP folder
immediately below it. VS Code projects workspace manifests into ordinary packs
and preserves their `osd` field.

VSIX packaging writes `{ "version": "x.y.z" }` to `osd-version.json` at the
system seed root, before prebuilding and calculating the seed ID. This is the
same version stamped into the extension: tracked `editors/vscode/package.json`
major/minor plus `git rev-list --count HEAD`. Seeded binaries use the same
seed packager and version rule. The extracted system home carries the marker;
a source checkout (including a checkout-mode binary) without one skips the
comparison and logs a debug line. Invalid markers refuse the build.

A mismatch exits with one clear diagnostic, leaves the live generation alone,
and appears verbatim in the desktop extension's error notification. Its Update
action opens the installed extension's entry in VS Code's Extensions view.
The binary update hint is in the diagnostic as well.

Focused tests: `test/layer-version.mjs`, registered in
`test/suites.d/layer-version.json`.
