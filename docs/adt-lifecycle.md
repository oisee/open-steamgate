# ADT object lifecycle and timings

`tools/adt-lifecycle.mjs` creates, edits, checks and activates disposable DEVC,
CLAS, INTF, PROG, INCL and DDLS objects through the pinned ABAP-FS SDK
(`abap-adt-api` 8.4.3) and the public VSP MCP client at `.github/ci/vsp.ref`.
The objects have unique names, must be absent before creation, and are deleted
in `finally` through real lock handles. Each deletion must be followed by 404.
Source readbacks compare exact contents, allowing only CRLF normalization;
active readbacks prove publication of the edited version.

Packages have no source editing/activation operation in these clients and are
reported as N/A. ABAP-FS PROG, INCL and DDLS preflight validation currently
returns 404: these three measured gaps are reported MISSING while creation
continues. Failed validation of another kind, failed creation, failed readback,
missing operations and cleanup failures make the job fail.

## Run locally

Prepare the repository's pinned runtime, libraries and fetched packs as for
`npm run transpile`. Install the SDK with `npm ci --prefix tools/abapfs-conformance`.
Build VSP from the public commit in `.github/ci/vsp.ref`:

```sh
ref="$(cat .github/ci/vsp.ref)"
git clone https://github.com/oisee/vibing-steampunk.git .local/vsp-source
git -C .local/vsp-source checkout --detach "$ref"
mkdir -p .local/vsp-bin
(cd .local/vsp-source && go build -o ../vsp-bin/vsp ./cmd/vsp)
VSP="$PWD/.local/vsp-bin/vsp" OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 \
  tools/osd-heavy.sh node tools/adt-lifecycle.mjs --start
```

Use Node 22. `--start` owns a server on the reserved `STG_PORT`, binds to
loopback and uses a separate file database. It closes the server and compiler
after cleanup. It uses ONE_RUNTIME=1, matching the measured Eclipse server. The default mode can target an already isolated local HTTP
server with `URL`; it refuses external hosts and embedded credentials.
`SDK_ROOT` and `VSP` select installed dependencies, and `OUT` selects the
report folder. The default is `.local/adt-lifecycle/report`.

## CI and performance comparisons

The `adt-lifecycle` job in `tests.yml` runs on its own runner beside the six
suite shards, using the same built-tree artifact. It is required by the
`test` gate. Its summary is appended to the overall PR test comment and
uploaded with JSON evidence and the server log, including when a run fails.
Raw local timings are not used as runner thresholds.

Each source object is edited three times; each edit changes its contents.
The report includes every sample and its median. SDK Save includes lock,
write, unlock and readback. VSP WriteSource includes Check and Activate;
these timings measure different client operations. Initial creation and
activation are separate from repeat edits. Compiler readiness is awaited
before each repeat. A compiler dropped by its normal memory guard is prepared
by activating the unchanged baseline; this preparation is separately reported
and excluded from edit medians. For CLAS, INTF and INCL, a generation change and an
increase in warm swap count are required. An unexpected cold publication
fails even when its timing happens to be fast. REPORT and DDLS presently
remain cold; their repeat timings are measured and compared too.

CI uses the most recent compatible successful `main` artifact from the last
20 successful push runs. Recipe, SDK, VSP, runtime/library pins, Node major,
OS and architecture must match. Timing exceeds the limit only when the
median is above both 150% of the baseline and baseline +1000 ms. This
allows small network/runner variation while catching sustained slowdowns.
The report identifies the operation, measured median, baseline and limit.
A missing compatible baseline is explicitly marked comparison pending;
functional and warm-path requirements remain enforced. After the first
successful main run the artifact supplies a baseline automatically.
Unreadable available evidence or an invalid compatible baseline fails.

`test/adt-lifecycle-report.mjs` injects sustained slowdowns, single outliers,
missing cleanup, failed validation/readback and incompatible toolchains.
It proves that sustained regression turns the comparator red and an isolated
outlier does not. The registered suite also verifies that MISSING allowances
cannot hide other failed operations.

## Initial local observation, 2026-10-05

The initial single-pass matrix produced 73 PASS, three MISSING validations,
four N/A package operations and zero FAIL. All 12 objects were deleted and
confirmed absent. These are local observations, not CI baselines:

| Object | SDK repeat activation | VSP edit + Check + Activate |
|---|---:|---:|
| CLAS | 2.4 s | 4.2 s |
| INTF | 2.5 s | 4.2 s |
| INCL | 2.6 s | 4.3 s |
| PROG REPORT | 28.0 s | 33.9 s |
| DDLS | 28.0 s | 33.8 s |

The protocol layer uses the actual clients. A real VS Code editor UI or
Eclipse wizard is outside this script's coverage.

## Three-sample local validation

The CI recipe passed with 123 PASS, three MISSING preflights, four N/A
package operations and zero FAIL; all 12 objects were deleted and confirmed
absent. Repeat activation medians were CLAS 2.333 s, INTF 2.419 s, INCL
2.416 s, REPORT 27.300 s and DDLS 26.738 s. VSP combined repeat medians
were 3.906 s, 3.981 s, 3.997 s, 32.030 s and 31.940 s respectively.
The full local run took approximately 15 minutes, including compiler
preparation and cold builds; GitHub runner duration remains unmeasured.
All 87 focused comparator/suite-reporter tests passed, actionlint and
suite registration passed. A sustained 15 s class-activation injection into
the real report exited 1 and named the operation; unchanged evidence compared
to itself passed. A clean VSP checkout build passed exact-commit metadata
validation and a real SyntaxCheck with the diagnostics parser.
