# Gateway regression contract v1

Status: GW0 local candidate, 2026-09-21.

This document defines the portable data and matching contract. The JavaScript
reference matcher and synthetic fixtures are a characterization oracle; they
are not the finished ABAP domain kernel and do not establish A4H behavior.

## Evidence levels

Every run records one evidence level:

- `synthetic`: authored fixture; no runtime or socket was exercised;
- `provider`: an in-process provider/dispatcher was exercised;
- `wire`: an HTTP boundary was exercised;
- `browser`: a real browser exercised the published application.

Requested mode and actual mode are recorded separately. A replayed fixture
cannot claim `wire` merely because the case requested wire execution.
Unknown source/live/serving identities remain `null`, not invented values.

## RegressionCase v1

```json
{
  "schemaVersion": 1,
  "id": "gw0.travel.read",
  "version": "fixture-v1",
  "description": "Read one synthetic travel",
  "destination": "DEMO",
  "request": {
    "method": "GET",
    "path": "/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('GW0-001')",
    "headers": {
      "accept": "application/json"
    }
  },
  "execution": {
    "mode": "wire",
    "timeoutMs": 10000,
    "session": "isolated"
  },
  "redaction": {
    "body": []
  },
  "expect": {
    "status": 200,
    "headers": {
      "content-type": {
        "mediaType": "application/json"
      }
    },
    "body": {
      "format": "json",
      "value": {
        "d": {
          "TravelId": "GW0-001",
          "Seats": 2,
          "Status": "A",
          "ObservedAt": "2026-09-21T00:00:00Z"
        }
      },
      "masks": [
        {
          "path": "/d/ObservedAt",
          "reason": "Synthetic response generation timestamp"
        }
      ]
    }
  }
}
```

`schemaVersion` versions the file format. `version` names an immutable
revision of this logical case. A repository may replace the opaque first-wave
label with a canonical content hash, but it must not silently mutate a version
already referenced by a suite or run.

The destination is a logical name resolved by the existing destination
registry. The request path is relative and begins with `/`; an exportable case
cannot carry an absolute server URL, Authorization, Cookie, a literal CSRF
token or credentials. Session adapters own those values.

Logical destination names use the bounded uppercase registry grammar
`[A-Z][A-Z0-9_.-]{0,63}`. An inline URL is never a destination name.

GW0 deliberately accepts only `GET`, no query or request body, and the fixed
request header `Accept: application/json`. Its only response-header assertion
is `Content-Type` with the `application/json` media type. It also rejects
unknown fields, origin escapes, fragments and controls. Wire adapters later add
structured query parameters, tagged request bodies and an explicit safe header
model, then enforce each destination's allowed method and path-prefix policy
before sending anything. They do not infer that permission from a syntactically
valid case.

The first schema admits `internal`, `wire` and `replay` as requested modes.
An executor advertises the modes it actually supports and refuses unsupported
combinations. It never silently falls back to a semantically different mode.

## RunResult v1

```json
{
  "schemaVersion": 1,
  "runId": "synthetic-run-001",
  "case": {
    "id": "gw0.travel.read",
    "version": "fixture-v1"
  },
  "target": {
    "destination": "DEMO",
    "requestedMode": "wire",
    "actualMode": "replay"
  },
  "provenance": {
    "evidence": "synthetic",
    "sourceRevision": null,
    "liveGeneration": null,
    "servingGeneration": null
  },
  "startedAt": "2026-09-21T00:00:00Z",
  "finishedAt": "2026-09-21T00:00:01Z",
  "outcome": "failed",
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "format": "json",
      "value": {
        "d": {
          "TravelId": "GW0-001",
          "Seats": 3
        }
      }
    }
  },
  "findings": [
    {
      "kind": "value-mismatch",
      "scope": "body",
      "path": "/d/Seats",
      "expected": 2,
      "actual": 3
    }
  ],
  "traceRefs": []
}
```

Outcomes are `passed`, `failed`, `error` or `cancelled`. A timeout,
unreachable destination, invalid case or unsupported assertion is never a
pass. Execution errors and business mismatches are distinguishable.
Malformed response envelopes are errors rather than business mismatches: the
status is an HTTP integer, headers are a token-to-string map, and bodies are
explicitly tagged before the matcher sees them.

The response is matched before persistence redaction. Redaction then applies
consistently to the saved response, findings and trace. Comparison masks and
security redaction are separate mechanisms.

Known session headers such as Authorization, Cookie, Set-Cookie and
X-CSRF-Token are always redacted from persistence. A body secret requires an
explicit `redaction.body` JSON Pointer with a reason; that pointer redacts both
the stored body and expected/actual values in findings without changing the
comparison verdict.

Redaction pointers in v1 are response-only: a case cannot store a literal
expected secret at that path. Secret-aware presence or shape assertions require
a later explicit matcher or secret reference. A stale or invalid redaction
quarantines the entire body and makes the run an error. Response persistence is
an allowlist of diagnostic headers, with an unconditional secret-header denylist.

The repository owns its schema; it does not reproduce SAP `/IWFND/*` tables.
Writes use compare-and-swap/ETag semantics, suites and runs refer to exact case
versions, imports reject identity collisions unless the content is identical,
and an immutable run keeps its referenced case version reachable. Retention
may archive runs and unreferenced versions, but deletion must never leave a
run silently pointing at different or missing case content.

Direct reads or writes of `/IWFND/*` tables and dependencies on private
standard classes are forbidden in the portable core. A classic-system adapter
may call an observed API only after its release/support status is recorded.

## JSON matching

- Objects ignore member order.
- Arrays retain order.
- Types are exact: `2`, `"2"`, `null` and a missing value differ.
- Every mismatch carries an RFC 6901 JSON Pointer.
- Every finding carries a scope (`http`, `body` or `case`), so `/status` in
  the HTTP envelope cannot be confused with a JSON member named `status`.
- A mask is an exact JSON Pointer plus a nonempty reason.
- Every mask must resolve in both expected and actual bodies.
- Duplicate, overlapping, malformed, stale or unsupported masks are
  configuration errors.
- No date, UUID, timestamp, port or row is ignored implicitly.
- Unsupported body formats or assertions fail closed.

The positive GW0 fixture changes only JSON member order and the explicitly
masked `/d/ObservedAt`; it passes. The negative fixture changes only
`/d/Seats` from 2 to 3; it produces exactly one value-mismatch finding at
`/d/Seats`. An unmasked timestamp or UUID change remains red.

Text and bytes are separate tagged matchers. Semantic XML needs a
namespace-aware implementation; the conformance runner's useful
`xpathish` check is not renamed or misreported as semantic XML.

## Existing mechanisms

The contract extends rather than replaces existing mechanisms:

- `test/conformance/run.mjs` already provides useful request/expect
  conventions, cookies, CSRF and broad compatibility assertions. Its Session
  becomes a future wire adapter; its suite remains the compatibility corpus.
- `tools/osd-replay.mjs` remains the branch-to-branch call adapter. Its
  global date/UUID normalizer is deliberately not the business matcher.
- `tools/rfc-replay.mjs` keeps typed RFC capture/replay. HTTP and RFC share
  logical target names, mode vocabulary, capture provenance and redaction
  policy, but not a protocol executor or fallback matching algorithm.
- `tools/osd-destinations.mjs` remains the single logical destination
  registry. GW0 creates no `gateway-destinations.json`.
- the existing build endpoint remains the authority for source/live/serving
  identities.

## Clean-room and authorization boundary

The supplied ZSCR examples inform observable workflows and field meanings.
Their implementation is not copied. Synthetic fixtures contain no captured
business data, credentials, host names or proprietary source.

GW0 local is complete when the contract validates, round-trips, passes its
positive control and fails its deliberate business mutation with the exact
finding. Full GW0 additionally requires the separately authorized A4H
characterization described in the parent plan. Synthetic or A4H-shaped data
must never be reported as observed A4H behavior.
