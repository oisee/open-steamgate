# DevUX groundwork: Gateway regression before Draft

Status: architecture decision and delivery plan, 2026-09-21.

## Decision

Build the Gateway regression kernel and its smallest Fiori client before the
full Fiori source editor. Keep browser VS Code parked as an optional
conformance surface.

OData is an API facade for this feature, not the place where its domain logic
lives. RAP/OData Draft is deliberately not a Wave 1 dependency.

The missing developer loop is:

```text
save / activate
       |
       v
run a named service case
       |
       v
inspect status, response and semantic diff
       |
       v
keep an immutable result and export the case
```

The editor backend already has one Object Store, inactive revisions, Check and
Activate. Building the test instrument first closes the feedback loop and then
gives the editor a reusable `Activate -> Run suite` action.

## The portable centre

The centre is a small application kernel with no dependency on UI5, DPC/RAP
classes, `/IWFND/*`, `/IWBEP/*`, HTTP clients, SAP tables or Node APIs.

```text
Fiori / CLI / Workbench
          |
          v
OData facade or direct application API
          |
          v
Regression application service
          |
          v
portable case + matcher kernel
          |
          +-- CaseRepository
          +-- RequestExecutor
          +-- DestinationResolver
          +-- SecretStore
          +-- Clock / IdProvider
          +-- ImportExportCodec
```

The canonical objects are:

- `RegressionCase`: identity, description, request, expectations, execution
  policy and an immutable version;
- `RegressionSuite`: an ordered selection of case versions;
- `TestRun`: target, exact case version, timestamps and state;
- `RunResult`: status, selected headers, response body, findings, semantic
  diff and trace references.

A case names a logical destination and a relative service path. It does not
store passwords, cookies, CSRF tokens or an arbitrary server-side URL.

## Two execution modes, not one misleading shortcut

An in-process call and an HTTP call answer different questions.

### Semantic/provider mode

This mode calls a provider or dispatcher without opening a network socket. It
is fast and valuable for deterministic unit and component tests. It does not
prove ICF routing, authentication, proxy headers, cookies, CSRF, compression,
redirects or exact wire serialization.

OSG already has `zcl_stg_dispatcher=>dispatch`, but the HTTP handler currently
owns the modifying-request COMMIT/ROLLBACK fence. Calling the dispatcher
directly is therefore not yet equivalent to serving a request. A direct
adapter must own the same explicit top-level request boundary rather than
quietly inheriting the caller's LUW.

On SAP systems, a documented local OData client/proxy may provide a similar
provider-level test where available. It must be labelled as local semantic
execution, not as a Gateway wire regression.

### Wire mode

This mode executes through the real HTTP/Gateway boundary. It proves routing,
authentication, session affinity, CSRF, cookies, client/language, `$batch`,
headers and serialization. It is the required mode for at least one A4H and
one OSG end-to-end gate.

The executor automates session mechanics, but the scenario still specifies
business-visible semantics such as the members and transactional boundaries of
a `$batch` changeset.

The two modes may share cases and matchers. Their results retain the mode so a
fast provider test cannot be reported as wire coverage.

## ADT is reused, but not as the request runner

ADT remains the right compatibility surface for repository development:

- browse and read source;
- lock and save inactive source;
- Check and Activate;
- ABAP Unit and development diagnostics;
- external Eclipse, VS Code/abap-fs and vsp clients.

It is not the natural transport for executing application OData or generic
REST cases. Tunnelling an HTTP-shaped message through
`SADT_REST_RFC_ENDPOINT` is useful when an ADT client reaches a system over
RFC, but it does not turn ADT into a stable, released application-test API.

The Workbench composes two explicit capabilities:

```text
source operations --> Object Store / ADT-compatible service
service tests     --> Regression application service / RequestExecutor
```

They meet at immutable identities: the run records the source revision and
active generation that served it.

The supplied ZSCR example definitely orchestrates the standard Gateway Client
through in-process ABAP APIs. It calls the standard configuration/executor,
case-save and case-execution services with ABAP values. That proves the
orchestration boundary, but not whether the implementation below the standard
executor uses a local Gateway dispatcher or a socket. The first A4H
characterization must record that distinction rather than assume it.

## Reuse the existing replay machinery without conflating protocols

`tools/rfc-replay.mjs` already establishes useful system-wide concepts:
logical destinations, explicit `local | replay | live | record | fallback`
modes, private captures under `.local/` and deterministic substitutions.
GW1 must not create a second registry for those concepts.

RFC calls and HTTP requests nevertheless remain different executor contracts.
RFC replay operates on typed function-module parameters and `sy-subrc`; the
Gateway runner operates on method, URI, headers and bytes. They should share a
small target/mode vocabulary, capture provenance, redaction policy and run
envelope, while retaining protocol-specific matching and execution adapters.
The HTTP case format does not automatically inherit powerful substitutions
such as `{{sql:...}}`; each substitution must be explicitly admitted and
safe for an exportable regression case.

## Why Draft waits

Wave 1 needs explicit Save, an ETag/version, a local dirty buffer and immutable
runs. That is enough to prevent lost updates and to run an exact saved case.

Draft would prematurely couple the domain model to different platform stacks:

- classic Gateway/SADL Draft V2 on older systems;
- RAP Draft and OData V4 in ABAP Cloud;
- a new emulation burden in OSG;
- a second meaning of draft beside the Object Store's inactive source.

Add Draft later only if users genuinely need long-lived, multi-user unfinished
case edits, ownership, resume and conflict workflows. At that point Draft is
an adapter over versioned `RegressionCase`, not the kernel's storage model.

## Super-necessary first slice

The first demonstrable slice contains only:

1. A canonical object-level `RegressionCase` schema.
2. A semantic JSON/XML/text matcher with explicit masks and assertions.
3. A logical destination resolved through the existing destination registry.
4. An executor with bounded timeouts, cancellation, isolated sessions and
   redacted traces.
5. One GET and one CSRF-protected modifying request.
6. Cookies, client/language and CSRF handled below the case authoring UI.
7. One saved case version and one immutable `RunResult`.
8. A positive control and an intentional business-field mismatch that produces
   a precise red diff.
9. Canonical JSON/ZIP import and export with no secrets.
10. The same case runnable headlessly and from a minimal Launchpad application.
11. A real A4H wire proof and a real OSG wire proof.

The existing replay normalizer must not be reused unchanged for business
regression: globally erasing every UUID and date can hide a real failure.
Normalization is explicit and owned by each case or suite.

## Transaction and isolation rules

Running a test from an OData `Run` action must not execute the target operation
inside the action's own LUW. A nested target request could otherwise commit or
roll back the saved case, Draft state or unrelated pending work.

The `Run` command first resolves an immutable case snapshot, then hands it to a
separate execution boundary: a host job/worker, a separate session/connection,
or an explicitly isolated top-level dispatcher transaction. Timeout does not
blindly retry modifying requests. A CSRF retry is allowed only after a
recognized token failure and a successful token refresh.

Test setup and cleanup use unique keys and explicit steps. A runner rollback
cannot undo remote HTTP commits that already completed.

## Delivery waves

### GW0 - characterize and freeze the contract

- use supplied examples only as clean-room behavioral references;
- treat A4H as an external sandbox that is exercised only after Alice
  explicitly authorizes that concrete run; the existence of GW0 is not
  standing permission;
- exercise the relevant standard A4H client operations and record observable
  request/result behavior with synthetic data;
- prove whether each candidate path is wire HTTP or local provider execution;
- define the canonical case, matcher and redaction fixtures.

Done when the document distinguishes observed, documented and inferred facts,
and a deliberately changed field makes the fixture fail.

### GW1 - kernel and headless runner

- implement versioned cases, semantic matchers and immutable results;
- use in-memory/fake ports for deterministic ABAP Unit tests;
- add OSG and A4H executor adapters without leaking platform types into the
  kernel;
- run one real GET and one modifying case.

Done when one suite is repeatable on OSG and A4H, and its negative control is
reliably red.

### GW2 - thin Fiori Gateway Client

- Launchpad tile;
- case list and detail;
- request editor, Run, response, findings and semantic diff;
- import/export canonical JSON/ZIP;
- bounded progress and cancellation.

Done when a user can perform the useful loop without a terminal, while the
same suite remains runnable in CI.

### GW3 - join the Workbench loop

- link a source/service object to selected suites;
- after successful activation offer `Run selected suite`;
- show the serving source revision/generation on every run;
- add browser tests for generated Fiori applications;
- export package plus subpackages as an abapGit ZIP.

Only after this seam is stable should the polished Fiori-native source editor
become the main UX investment. In delivery terms UX1 starts after GW2 and
braids with GW3: a source-edit slice and its service-regression slice ship
together instead of completing all of GW3/GW4 before editor work begins.

### GW4 - optional expansions

- native Gateway Client compatibility codecs and table/XML adapters;
- multi-step variables and richer `$batch` scenarios;
- scheduling, retention and suite dashboards;
- RAP Draft for collaborative case authoring if evidence justifies it;
- Pages replay/synthetic sandbox;
- desktop OSG extension.

## Explicit deferrals

- a complete clone of ZSCR_120 or `/IWFND/GW_CLIENT`;
- making standard SAP tables the canonical repository;
- arbitrary scripts or arbitrary server-side URLs in a case;
- a full assertion programming language;
- all OData dialects in the first release;
- embedded VS Code;
- Draft as a prerequisite for Save or Run;
- claiming that a provider-level direct call proves HTTP behavior.
