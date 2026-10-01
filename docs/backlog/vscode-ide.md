

### Desktop VS Code OSD supervisor extension (2026-09-21)

Create an extension for real desktop VS Code, distinct from the browser
code-server image. Use the desktop Node extension host only as a thin lifecycle
supervisor for a pinned OSD runtime: `Start`, `Stop`, `Status`, `Open Launchpad`
and `Connect with abap-fs`. Run against the currently opened Git checkout so
source, Git diff and ADT object state describe the same files. Require Workspace
Trust, bind loopback by default, allocate/check instance-derived ports, keep
database state outside the extension install directory, and terminate children
on explicit stop or extension shutdown.

Do not perform npm/git downloads or a source build during extension activation.
Evaluate two explicit distribution modes: a signed/checksummed per-platform OSD
archive fetched by exact version, and an externally installed `osd` CLI. Show
the runtime/source revision and mismatch in the status UI. Never auto-commit or
push. Acceptance must cover Windows x64, macOS arm64, Linux x64 and Raspberry
Pi arm64, including restart/persistence, port collision, failed startup, stale
child cleanup and upgrading the runtime without touching the user database.

### Browser workbench product entry and operator docs (2026-09-21)

The W2 code-server/abap-fs developer loop is reproducible and documented in
`docs/vscode-workbench-spike.md`, but it is not yet a normal product entry.
Before calling it discoverable, add a short operator path to both `README.md`
and `docs/spin.md`: start OSD and the opt-in workbench Compose from the same
checkout, create the IDE secret, keep the default loopback bind, use an SSH
tunnel for another workstation, and explain the separate OSD and IDE ports.
Link to the detailed spike document instead of duplicating its security model.

Add a Launchpad **Workbench** tile which opens the authenticated IDE in a new
tab. Its URL must be deployment configuration rather than a baked-in host or
port. Keep `/sap/bc/osd/edit/` as the small in-system repair editor and make it
discoverable too, but do not call either surface SE80. Do not iframe code-server
until WebSocket upgrades, service workers, CSP, cookies and logout have browser
coverage. Add Playwright checks for the configured link, new-tab navigation and
the disabled/absent state when no workbench URL is configured.

### Measure: does a second Start with unchanged sources reuse the generation? (2026-10-01)

0.5 should (Alice). The claim is that a second `osd: Start` from the released VSIX, with no source changed since
the first, skips the cold build because the generation is keyed by a hash of its inputs, and that this was already
true before the transpiler fork with `only` landed in the VSIX (0.4.1413). It has not been measured on the released
artefact. Measure on VSIX 0.4.1414 (bundled system and an opened checkout, Linux x64 and one of macOS arm64 /
Windows x64): wall time from Start to the first 200 of the demo service, for (1) the first Start in a fresh
user-data dir, (2) Stop + Start with nothing changed, (3) Stop + Start after touching one class body, and (4) a VS Code
window reload with the system left running. Read from the "osd system" channel whether the build was reused,
warm or cold and why, and record the generation id each time. Acceptance: (2) and (4) do not rebuild, and the
numbers land in `docs/warm-compile.md` next to the save-to-system figures. If (2) rebuilds, find which input changes
the hash between two Starts (a timestamp, a temp path, readdir order, the storage dir) and fix that, the same way
`gen/` ordering was fixed for the binary.

### "Take it to a system": closure of an object into a deploy unit (2026-10-01)

Alice's request via osg-demo. **CLI first (0.5 nice), wizard second (0.6 should).** From one object (or several),
compute what it needs and write it as a unit of `deploy/manifest.json`, the source of truth `segw:zip`,
`tools/osd-deploy-manifest.mjs` and osg-demo's smoke check 10 already read; the zip stays `segw:zip --unit`.

- Closure from what the system already knows: the cross-reference seeded at boot (CROSS / WBCROSSGT / D010INC),
  abaplint references, DDIC chains (TABL → DTEL → DOMA, SHLP), SEGW (IWPR/IWSV/IWMO → MPC/DPC/_EXT), CDS,
  BSP/WAPA + SICF, PROG includes, FUGR.
- Boundaries chosen by the user: stop at a package or list of packages; never pull bundled-system or lib objects
  (listed as "expected on the target"); never SAP standard (listed as a prerequisite).
- Refused up front, with the reason: engine-only objects (ZIF_OSD_* implementers and their users, the job doctor,
  converted ZGUI_ transactions), and DSL sidecars, which `not_in_system` already names.
- Output groups: Needed / Optional (test classes, seed rows as a separate data unit) / Refused (reason) / Expected on
  target. `--dry-run` diffs against an existing unit; `--used-by` answers the reverse question.
- CLI: `osd closure <object>... --stop-package <p>... --unit <name> [--write|--dry-run]` (name to settle), one
  module the extension calls, not a second implementation.
- Wizard: "osd: Take it to a system…" on an editor or tree selection, a checkbox tree over the CLI's groups, then
  "Write zip" or "Save as deploy unit".
- Acceptance: osg-demo's ZCL_ZOSD_FLEET_DPC_EXT plus its app gives exactly their current manifest unit (smoke check 10
  compares the two), and the zip imports on A4H with the existing last-mile checks (docs/a4h-deploy.md).

### The generation DSL in the editor: trace navigation, diagnostics, schemas, `.tpl` highlighting (2026-10-01)

**0.6 nice (Alice). Not started until the DSL syntax settles.** Each L2 slice still adds constructs, so schemas and a
grammar written now would go stale with every PR. Today the extension has no language, grammar or schema for any of
the DSL files. L2/L3 rule YAML and `*.stg.yaml` get plain YAML colouring and `recipe.json` gets plain JSON colouring;
the 13 `.tpl` templates have none. The steps below are in order of value, and each is its own slice:

1. **Trace navigation.** Hover a line of a generated region to see the template line and the model path that produced
   it, from the trace sidecar, and click through to the template. The sidecar format is the most stable part of the
   DSL, so this one may start before the rest.
2. **Diagnostics.** Run `dsl build --check` and the L2 compiler on save and put their `file:line` errors into
   Problems. Parse the tools' existing output; do not write a second checker.
3. **Schemas.** JSON Schema for the L2/L3 rule YAML, `*.stg.yaml` and `recipe.json`, contributed through
   `yamlValidation` (needs the Red Hat YAML extension) and `jsonValidation`. Derive the schemas from the compilers'
   own accepted shapes, and test that every file in the tree validates and that each refusal fixture fails.
4. **`.tpl` highlighting.** A TextMate injection grammar for the Mustache-subset tags over ABAP. Cosmetic, so last.

Start condition: two consecutive L2/L3 slices that add no syntax, or an explicit freeze of the DSL grammar.
