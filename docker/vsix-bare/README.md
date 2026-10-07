# Bare-system VSIX smoke

This small module owns the container, VS Code test harness, host orchestration
and negative layer fixture. Its public entry point is
[`tools/osd-vsix-bare-smoke.mjs`](../../tools/osd-vsix-bare-smoke.mjs).
The host needs Node and Docker; the container has neither Node, npm nor Git on
PATH, and receives no checkout, host cache, node_modules or Docker socket.
Only the VSIX and optional layer are copied into its read-only input mount.

```sh
# Build a VSIX with scripts/build-vsix.mjs, then install and test it.
OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh node tools/osd-vsix-bare-smoke.mjs

# Reuse a local package, or fetch a published release and its checksum.
node tools/osd-vsix-bare-smoke.mjs --vsix /path/package.vsix
node tools/osd-vsix-bare-smoke.mjs --release "$RELEASE_TAG"

# A pinned external layer can be copied in without its .git or node_modules.
node tools/osd-vsix-bare-smoke.mjs --vsix /path/package.vsix --layer /path/osg-demo

# Negative proof: BTCSELECT has SCHEDUL, not SCHEDULED. Expect nonzero and
# osd-build: FAILED: check_syntax ... in the printed extension output.
node tools/osd-vsix-bare-smoke.mjs --vsix /path/package.vsix \
  --layer docker/vsix-bare/fixtures/bad-layer

# Fast module checks; these do not prove an installed VSIX works.
node --test docker/vsix-bare/*.test.mjs
```

Both Ubuntu 24.04 stages use the same pinned OCI index digest, obtained from
Docker Hub's registry API via `gh api` on 2026-10-04 (Docker is absent on the
editing host). The advisory workflow's five action refs are pinned to full
commit SHAs resolved from their major-version tags through GitHub's API via
`gh api` on the same date.
The Ubuntu runtime contains Xvfb and VS Code's shared-library dependencies.
VS Code is the official Linux x64 1.101.2 tarball, pinned to commit
`2901c5ac6db8a986a5666c3af51ff804d05af0d4`. Its SHA-256 is checked before
extraction; the checksum comes from Microsoft's
[version API](https://update.code.visualstudio.com/api/versions/1.101.2/linux-x64/stable).
The download stage's curl is absent from the final image. Both image build and
container entry reject Node, npm or Git on PATH. VS Code's own embedded Node
runs the harness and extension, as on a user's desktop.

Each run installs with `code --install-extension` into fresh extension and
user-data directories. The installed extension directory becomes VS Code's
`--extensionDevelopmentPath` solely to enable its `--extensionTestsPath`
protocol. The harness verifies the extension path, activates the installed
package and finds Start by its title in that package's command contributions.
The test file is copied beside the installed entry point so VS Code gives it
the same extension API object for the prompt and output-channel wrappers.
It answers the first-start bundled-copy choice if shown; error prompts never
trigger retries. It requires Start to return success, then checks ready state,
launcher identity, generation and HTTP 200 at the demo's `$metadata`, including
the matching `X-OSD-Generation` header. Stop must refuse a fresh connection
with `ECONNREFUSED`; a timeout or connection reset fails the check.
No framework or separately installed test extension is needed.

Layers are copied into a writable workspace inside the container and pass
through the extension's ordinary workspace-layer projection and build. The
negative fixture is outside the repository's transpile inputs. Failure prints
captured extension output (including the system's build/boot log) and the
persisted VS Code logs, including output channels activated before the harness.
A PASS marker is required in addition to VS Code's exit status.

The GUI test launches `/opt/code/code` directly. In pinned VS Code 1.101.2,
the `bin/code` CLI detaches Electron, ignores its stdout/stderr and returns
before tests finish unless special wait handling is requested
([CLI source](https://github.com/microsoft/vscode/blob/2901c5ac6db8a986a5666c3af51ff804d05af0d4/src/vs/code/node/cli.ts#L216)).
Using that CLI under `xvfb-run` ended the display lifetime and checked PASS
before an extension host could start. The direct executable keeps the display
and timeout alive until Electron exits and preserves its exit status. Both
launches retain `--no-sandbox` and `--disable-gpu`; the image runs as `smoke`,
not root. `xvfb-run` waits for the display before launching the process.
The existing CommonJS `exports.run(): Promise<void>` harness protocol is
supported by the pinned
[extension host](https://github.com/microsoft/vscode/blob/2901c5ac6db8a986a5666c3af51ff804d05af0d4/src/vs/workbench/api/common/extHostExtensionService.ts#L743).

Code stdout/stderr streams to the host and `/smoke/code.log`, installation
output to `/smoke/install.log`, and Xvfb diagnostics to `/smoke/xvfb.log`.
Failure reports the stage and exit code, then the last 300 lines of every file
under the user-data logs directory (including nested exthost, renderer and
output-channel files), plus other `.log` and osd text logs under `/smoke`.
No extra dbus setup was justified by the supplied log; any subsequent startup
error is now visible. Module tests cover process lifetime, launch paths and
flags, exit status, stderr/log reporting, Xvfb failure and missing PASS.

Supplied Docker evidence from the i7 host: release
`vscode-stable-v0.6.1666` passed the bare-container smoke in 31.8 s, with
the first answer 12.99 s after Start resolved. The same release with
`fixtures/bad-layer` exited 1 and reported
`check_syntax, Component "scheduled" not found in structure`.
The editing host has no Docker executable or daemon socket, so these are
the i7 results, not a container run on the editing host.

Start is bounded to 540 seconds; activation and Stop have separate limits.
Every HTTP request has a five-second absolute deadline that destroys the
request even if data keeps arriving. The first-answer poll has a 120-second
budget; each request and retry delay is capped to its remaining time.
Shell installation/test deadlines are 180/660 seconds, with a 10-second
kill grace. Host Docker run is bounded to 960 seconds and removes its uniquely
named container even after a timeout. Image/VSIX builds have 20-minute limits;
each release fetch has a five-minute limit. Timings are printed for each host
stage and the extension test itself. Every container starts from a fresh home.
The launcher chooses a free port; Docker publishes **no** host ports, so the
HTTP probes run wholly inside the container.

Docker caches the image's layers normally. `--skip-image-build` uses the
existing `osd-vsix-bare:code-1.101.2` image, useful for repeated probes. The
optional [advisory workflow](../../.github/workflows/vsix-bare-smoke.yml) uses
the Actions Docker build cache and runs only on manual dispatch and
`vscode-v*` and `vscode-stable-v*` tags (stable channel, #606).
It does not participate in required CI or publish anything.
Tag runs build that tag's checkout, avoiding a race with release publication;
manual runs may select an already published release instead.

Earlier local validation on 2026-10-04: eight module/harness checks passed in 0.116 s
on Node 24.16.0. Verified upstream main `d1a49bb5` was packaged in a clean
temporary clone with the locked toolchain and sources in 37.02 s as
`open-steamgate-0.6.1664.vsix` (20,218,402 bytes, SHA-256
`f9ddfb139440708bbb4d2d8065af4711b8078e5f37040d9bd9bc5341ca903878`).
The packaged seed's actual builder rejected the bad layer with
`osd-build: FAILED: check_syntax, Component "scheduled" not found in structure`
at class line 8. This is a native builder check, not a bare-container result.
The final fixture's native rejection took 11.09 s and exited 1.
Local container invocations exited with `spawn docker ENOENT` before
installation; the supplied i7 container pass/fail evidence is recorded above.

After the critic fixes on 2026-10-04, all 17 module/harness checks and
actionlint passed. Restoring inactivity timeouts and accepting any Stop
request error made the trickling-response and both surviving-listener
regressions fail (three red proofs).
