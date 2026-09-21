# Browser VS Code workbench spike

Status: active spike on `feat/live-workbench-activation`, 2026-09-21.

## Decision

Use **code-server as a separate, opt-in container**, with a pinned build of
`vscode_abap_remote_fs` preinstalled. W0 connects through the Docker host
gateway to an OSD process running from the same dedicated Git worktree; the
paired deployment profile will put both services on one private network. The
first version opens in a separate browser tab/port. It is not embedded in an
iframe and it is not part of the normal runtime image.

This decision followed an independent Astra critique. OpenVSCode Server would
also provide the required remote Node extension host, but code-server already
has password authentication, a health endpoint, persisted settings and more
mature path/reverse-proxy behavior. Plain `vscode.dev` is not an option:
abap-fs declares a Node `main` entry point and no browser entry point.

## Pinned inputs for the first build

- code-server `4.138.0`; confirm its bundled Code version is at least `1.105`
  before accepting the image.
- `murbani.vscode-abap-remote-fs` `2.9.1`, release commit
  `9c4ef527310e67fd459b6ab0594642e67e35d162`, VSIX SHA-256
  `6a05dd256014e1463941eecb8a6318e996b5feb78d60f4a5657c17e270942577`.
- `larshp.vscode-abap` `0.5.4`, VSIX SHA-256
  `816bebcb5cfba92c3fd57a3b58fa476757acd9427bd466380f783a76edb4f773`.
- `hudakf.cds` `0.7.3`, VSIX SHA-256
  `c4d8d96629eed392fff3928f0073ae55065b3e8c01cf4e0498914bc9096da0d3`.

The pinned abap-fs bundle needs one explicit compatibility shim under the
Node runtime bundled with Code 1.138: one bundled dependency selects its
browser branch merely because Node now defines `navigator`. VS Code strips
both `NODE_OPTIONS` and `VSCODE_NODE_OPTIONS` before it launches the
extension host, so the image patches only that dependency's minified feature
probe. It does not mutate the shared extension-host global. Remove the shim
when an upstream release completes the Node migration; the VSIX checksum
above remains the checksum of the reviewed input artifact.

Download and install these during the image build, never at container startup.
Use Open VSX or the upstream GitHub release assets, not Microsoft's extension
marketplace. Record licenses, release URLs and hashes in the image.

## Topology and trust boundary

```text
browser --TLS/auth--> code-server --private HTTP--> OSD ADT façade
                          |                          |
                          +-- dedicated worktree ---+
                                      |
                                  host Git
```

The shared worktree is deliberate. `adt://` is a virtual filesystem and does
not automatically appear in VS Code's Git panel. Git history and diff become
useful only when the IDE and OSD operate on the same checkout. Use one
worktree/branch per user or instance; never share one dirty checkout between
independent workbenches.

The IDE is remote command execution by design. It must be non-root and must
not receive the Docker socket, the host home directory, SSH keys or unrelated
volumes. Mount only the dedicated worktree and a named settings/extensions
volume. Drop capabilities, enable `no-new-privileges`, keep Workspace Trust,
and expose only the authenticated IDE. OSD's current ADT Basic credentials are
not validated, so bind it to localhost or a private network for this profile.
Public deployment additionally requires TLS/reverse-proxy auth.

Disable abap-fs AI/MCP auto-start, telemetry and broad test automation for the
first spike. Do not enable Git auto-commit or push: Save creates an inactive
edit, Activate publishes it, and Commit/Push remain explicit user actions.

## Run the W0 image

Start OSD from this same checkout on port 3030. Then copy
`docker/workbench/ide-password.example` to the ignored
`docker/workbench/ide-password.txt`, replace its value, and run:

```sh
docker compose -f docker/compose.workbench.yml up -d --build
```

Open `http://127.0.0.1:8088`. Override `OSD_IDE_PORT`, `OSD_ADT_URL` or
`OSD_ADT_USER` when needed. The default bind is loopback-only. The Compose
profile mounts only this checkout plus named code-server data/config volumes;
it drops all capabilities, enables `no-new-privileges`, uses a read-only root
filesystem and has no Docker socket, host home or SSH mount.

W0 has been built and smoke-tested on linux/amd64: all three pinned extensions
load into Code 1.138, unauthenticated access redirects to login, the health
endpoint responds, and the process runs as the unprivileged `coder` user. The
arm64 build and license/content inventory remain before multi-arch readiness.

## Milestones

### W0 — reproducible IDE image

- Multi-arch image for `linux/amd64` and `linux/arm64`, pinned code-server and
  VSIX hashes, no startup downloads.
- Preconfigured W0 connection through the Docker host gateway using a
  non-secret demo username; the IDE password/token comes from a secret, never
  the image.
- The container health-checks code-server; the image build verifies all three
  extensions are installed. Compose config validation and a license/content
  inventory test.

### W1 — real-client compatibility capture

- Bring up disposable OSD + IDE + SQLite database and connect with the actual
  abap-fs extension, not a simulated request sequence.
- Record `STG_ADT_DUMP` and `/osd/not-served`. A route the client never tried
  is unknown, not passing.
- Fix only blockers for the acceptance path below. Keep capability discovery
  honest; unsupported ATC, debugger, CTS, dumps and DDIC editors must not be
  advertised as working.

W1/W2 evidence, 2026-09-21: the pinned abap-fs 2.9.1 extension loaded in
code-server, accepted the configured OSD system, added `OSD(ABAP)` to
Explorer and expanded `$TMP/$STG/$STG_ICF`. A real browser opened
`ZCL_STG_ICF_DEMO.clas.abap`, saved through ADT and invoked the extension's
activation and ABAP Unit commands. The container remains read-only and
unprivileged; cache and unavoidable `.copilot` state stay in its dedicated
cache volume, while the Agent UI and code-server port proxy are disabled.

### W2 — developer loop acceptance

In one Playwright/manual-assisted browser run against a disposable worktree:

1. Log into code-server and connect the preconfigured OSD system.
2. Expand a package and open a class with the correct source and object state.
3. Save invalid source: it reads back inactive and the problem names the exact
   ABAP line. Activation fails; the previous runtime response and generation
   remain live.
4. Fix, save and activate: wait until the new generation is serving.
5. Run one ABAP Unit method and see a green result.
6. Open VS Code Source Control and verify that host Git shows the same edit.

Run amd64 first. Run the same acceptance on the Raspberry Pi arm64 before
calling the image multi-arch-ready.

W2 amd64 evidence, 2026-09-21: `test/e2e/workbench-w2.mjs` completed the
whole loop against disposable code-server volumes and a dedicated worktree.
An invalid save appeared in Problems and left both the serving generation and
`W2-OLD` runtime response unchanged. The corrected source activated a new
generation and changed the live HTTP response to `W2-NEW`; Testing displayed
a non-empty two-item ABAP Unit result, Source Control displayed the same
ADT-written class, and the scenario restored and reactivated `W2-OLD`.
`Refresh ABAP filesystem` was also found in the real root context menu and
invoked. The pinned client renders the test result at object-summary level in
this Code build; exposing class/method rows remains a follow-up, not a claim
of this milestone.

The harness defaults to the documented ports and accepts
`OSD_WORKBENCH_URL`, `OSD_RUNTIME_URL` and `OSD_IDE_PASSWORD_FILE` for a
disposable parallel instance. Start it with
`npm run e2e:workbench`; it restores and reactivates its `W2-OLD`
fixture before returning successfully.

### W3 — product integration

- Add a launchpad/workbench link that opens the authenticated IDE in a new
  tab. Do not iframe until WebSocket upgrades, service workers, CSP,
  `frame-ancestors`, cookies and logout have their own E2E coverage.
- Show three separate identities: worktree branch/HEAD, inactive source
  revision, and active serving-generation hash.
- Preserve the small zero-JavaScript in-system editor as a repair/fallback
  surface; code-server is the rich IDE, not the only way to recover code.

## Expected compatibility gaps

OSD already has package browsing, class source documents, active/inactive
state, ETags, sessions and locks, write/check/activate, ABAP Unit and the
abap-fs compatibility graph. That is enough to justify the spike, not enough
to claim compatibility. Likely gaps include object-name validation/create
routes, interface outline merge, the `localtypes` include, non-class editor
documents, DDIC mutation, ATC/debugger/CTS/dump surfaces and test-database
isolation with persistent `STG_DB_PATH`.

The activation fix in this branch is a prerequisite: failed publication and
a save arriving during publication must leave the source inactive.

## Stop/go rules

Proceed to W2 only if abap-fs loads unchanged in code-server and reaches OSD's
compatibility graph. If it needs a small upstream-neutral patch, maintain it
as an explicit patch/PR with a test. Stop if the extension requires Microsoft-
only APIs, if secure auth cannot be put in front of the IDE, or if a shared
checkout cannot preserve OSD's inactive/active semantics. In that case keep
the existing editor and improve the ADT contract for desktop VS Code instead.

The spike does not publish images, update `latest`, deploy to a public host or
merge to `main` without the normal PR checks.
