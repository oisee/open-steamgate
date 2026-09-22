# Preview release and OSD Doctor plan

Written 2026-09-22. This is the next execution plan after the first verified
multi-platform OSD image. The order matters: publish a reproducible preview,
then make the checks used to accept it visible from OSD itself.

## 1. Publish `v0.1.0-preview.1`

The existing `draft` proves the distribution path on real AMD64 and Raspberry
Pi ARM64 hosts. It is not the release artifact: its child images were built
from revision `9a52fc1`, while documentation and multi-arch automation landed
after that revision.

Release procedure:

1. Extend the image workflows with a release mode before cutting the release:
   both architecture builds accept the same version Git tag as their ref, and
   the manifest workflow accepts an optional version tag. Release mode first
   creates and verifies a unique pinned manifest, then the versioned tag, and
   moves `draft` last. Each architecture build also writes a stable
   `buildIdentity` (`commit/run/attempt/platform`) into
   `/opt/osd/image-build.json` before acceptance. Normal draft behaviour
   remains unchanged.
2. Choose one clean `main` commit and create the annotated Git tag
   `v0.1.0-preview.1` on it **before** either architecture build. Never move or
   replace this tag. If acceptance fails and source must change, use the next
   preview version rather than reusing the tag.
3. Build AMD64 and ARM64 with that exact Git tag as the workflow ref and record
   both runs' provenance. Required release gates are:
   - AMD64: SQLite, DuckDB and PostgreSQL automated acceptance;
   - AMD64 HANA Express: i7 pulls the exact immutable AMD64 child digest chosen
     for the manifest, then runs fresh HXE, OData write/read and whole-stack
     restart after accepting SAP's license; retain the report with that digest,
     source commit and workflow run provenance;
   - ARM64: SQLite and DuckDB automated acceptance;
   - both architectures: HTTP/HTTPS, OData, SAP-TUI over DIAG, ADT over RFC and
     persistence across restart.
4. Combine only those two accepted image digests. Verify their OCI revision
   labels equal the Git tag's commit, their provenance names the two accepted
   runs, and the result has exactly the expected platform/digest members.
5. Publish the same manifest under:
   - `ghcr.io/oisee/open-steamgate:v0.1.0-preview.1`;
   - a unique `sha-<commit>-run-<run>-<attempt>` tag;
   - `draft`, after the versioned tag succeeds.
   Before writing the version tag, fail if it already names another digest;
   an idempotent retry is allowed only when commit and digest are identical.
   After publication, verify the versioned, unique and `draft` references all
   resolve to the new manifest digest.
6. Create a GitHub prerelease at the same source commit. Include links to
   `docs/spin.md`, the manifest digest, the tested platform/database matrix,
   demo credentials warning and known protocol limitations.
7. Pull the versioned tag once on an AMD64 host and once on `pi48w`; verify
   automatic platform selection and run the standard image probe.

The release is accepted when the Git tag, GitHub prerelease, OCI revision
labels and both image children all name the same source commit. Never retag an
older image as a newer source release.

## 2. Build OSD Doctor

OSD Doctor owns **system-scoped diagnosis**. It reports what the running OSD
can prove internally and the latest external evidence about its published
doors, from a CLI, CI and one Fiori cockpit. It does not become a second ABAP
Unit engine.

The Workbench keeps **object-scoped** discovery, execution and navigation for
ABAP Unit classes. The two surfaces may consume the same small result shape,
but neither calls the other as a mega-runner.

### Shared result contract

Every run produces JSON with this stable minimum:

```json
{
  "schemaVersion": 1,
  "runId": "doctor-…",
  "suite": "runtime",
  "scope": "system",
  "vantagePoint": "internal",
  "status": "passed",
  "startedAt": "…",
  "finishedAt": "…",
  "buildIdentity": "commit/run/attempt/linux-arm64",
  "sourceRevision": "…",
  "imageDigest": null,
  "servingGeneration": "…",
  "identity": {
    "systemID": "OSD",
    "instance": "11",
    "client": "001",
    "database": "sqlite",
    "architecture": "arm64"
  },
  "checks": [
    {
      "id": "https-adt-build",
      "status": "passed",
      "durationMs": 12,
      "summary": "HTTP 200; serving generation matches"
    }
  ]
}
```

Allowed run states are `queued`, `running`, `passed`, `failed` and
`cancelled`. A check may additionally be `skipped` or `unavailable`, with an
explicit reason. Secrets, cookies, authorization headers and RFC logon payloads
must never appear in the result.

`vantagePoint` is required and is either `internal` or `external`. Internal
evidence cannot be presented as proof of host port mapping, DNS, certificate
SAN, firewall reachability or behaviour of a real SAP client.

### Suites and execution boundary

The first version has two suites:

- `runtime` is safe to launch from the running system. It checks identity and
  generation consistency, database facts, loopback HTTP/HTTPS ADT discovery,
  OData metadata/read, listener state and bounded internal JS protocol
  self-checks. DIAG/RFC entries are explicitly labelled internal; they are not
  a claim that SAP GUI, Eclipse or host-published ports can connect.
- `deployment` is external and may create data or restart containers. It
  remains in `docker/image/smoke.sh` and CI, where it verifies persistence and
  native SAP-TUI/RFC client behaviour through published ports. This external
  suite remains a release gate. The Fiori application displays its latest
  trusted imported result but cannot run it or restart its own container.

Runtime protocol checks reuse the JavaScript server contracts; wire-level
acceptance continues to use the test-only SAP-TUI/RFC probe image. No Go tool
or probe binary enters the runtime image. A plain TCP connect is a port fact,
not a successful DIAG or RFC check, and must be labelled as such.

### API, security and state

Reserve `/sap/bc/osd/doctor` for the application and
`/sap/bc/osd/doctor/api/runs` for its read-only API. OSD currently has no real
role/authorization model, so the first Fiori cockpit **cannot start a run**.
Runs are launched locally by the fixed Doctor CLI or by CI. Targets are
compiled-in loopback OSD paths and ports; callers cannot supply a URL,
hostname, command or filesystem path. Adding a browser start action is a later
feature gated on real authorization, not Basic Auth display identity. Apply
fixed per-check timeouts to the CLI.

External results are imported only by a local CLI/startup path, never by a
browser upload. Import requires the versioned RunResult schema, rejects unknown
fields, caps a report at 1 MiB, strips control characters and marks the result
as external evidence rather than recomputing trust from its claimed status.
Every external result carries build identity, source revision, child image
digest, instance, serving generation and timestamp. The running image reads
its build identity from `/opt/osd/image-build.json`; it never mounts the Docker
socket or guesses its registry digest. The reader compares build identity,
instance and generation and labels evidence `current`, `stale`, `mismatched`
or `unverified`; only an exact current match can contribute a green deployment
status. If an orchestrator explicitly supplies the expected image digest, it
is compared too. Internal results leave `imageDigest` null. The UI renders
every value as text.

The CLI owns a filesystem lease created atomically under `.local/doctor/`; a
second CLI run exits with a documented busy status. The façade only reads
immutable snapshots, so work-process count cannot split ownership. History is
written atomically, capped at 20 runs and 10 MiB total; the next CLI invocation
marks an interrupted `running` record as `cancelled`. Signals cancel probes and
leave no orphan. This state is diagnostic history, not an application/DDIC
table.

Ownership for the first slice is `tools/osd-doctor*.mjs`,
`tools/osd-run-result.mjs`, `test/osd-doctor*.mjs` and `webapp/doctor/**`.
Changes to shared façade routing, `src/bsp/apps.json`, launchpad code or CI need
an explicit handoff. Workbench keeps its existing ABAP Unit routes and files;
regression tests must prove its `abapunit/testruns` endpoints are unchanged.

### Delivery slices

1. **Runner and contract**
   - one Node entry point that runs the safe `runtime` suite;
   - deterministic JSON plus a concise terminal report;
   - per-check timeout and duration;
   - unit tests for pass, unavailable, timeout and redaction.
2. **Runtime API and history**
   - read-only list/detail/download endpoints;
   - CLI lease and bounded recent history stored outside application tables;
   - cancellation on shutdown and no orphaned probes.
3. **Fiori cockpit**
   - one launchpad tile with live overall state;
   - identity/database/ports summary;
   - current/stale external-evidence marker, check list and failure details;
   - copyable CLI command for starting a new run;
   - download the exact JSON report.
4. **CI and image integration**
   - execute the same runner in normal CI;
   - import the richer external deployment result into the same view;
   - retain machine-readable and human-readable artifacts.

### Acceptance criteria

- SQLite and DuckDB pass on AMD64; SQLite passes on Raspberry Pi ARM64.
- HANA/HXE reports the same logical checks without exposing credentials.
- HTTP and RFC checks prove they reached the same serving generation.
- Every displayed check identifies its internal or external vantage point.
- Release acceptance includes an external published-port result; an internal
  green run alone can never make the deployment green.
- Disabled or unsupported capabilities remain visible as `unavailable`, not
  silently absent or falsely red.
- A failed check identifies the door, target, elapsed time and safe diagnostic
  reason.
- Stale or mismatched external evidence is visible and cannot make the current
  deployment green.
- Running Doctor does not rebuild OSD, mutate business/demo data, restart the
  process or require Go.
- Workbench ABAP Unit behaviour and ownership remain unchanged.

### Explicit non-goals for the first version

- generic RFC compatibility;
- administering HANA or container lifecycle from Fiori;
- replacing image acceptance or real SAP-TUI/Eclipse tests;
- accepting arbitrary probe targets or browser-uploaded reports;
- starting a Doctor run from the browser before real authorization exists;
- scheduling, alerts or remote fleet management;
- merging system diagnosis and object-level ABAP Unit into one runner.

## 3. Automate multi-arch promotion later

After one versioned preview has exercised the manual release path, add a small
coordinator that promotes `draft` only when AMD64 and ARM64 publications for
the same OCI revision are both green. It must pass immutable digests to the
existing manifest workflow and must not rebuild images. Keep a manual dispatch
as the recovery path.

This is deliberately third: the current workflow is short and safe, while a
Doctor immediately reduces the cost of every Portainer and release check.
