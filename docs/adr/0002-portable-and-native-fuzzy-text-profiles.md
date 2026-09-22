# ADR 0002 — Portable and native fuzzy-text profiles

**Status:** Accepted
**Date:** 2026-09-22
**Deciders:** Alice; open-steamgate
**Context:** portable AMDP / SQLScript runtime and its synthetic observation-reconciliation corpus

## Context

Approximate text matching is not one portable database operation. HANA fuzzy
search, edit-distance functions, DuckDB string-similarity functions and
full-text ranking engines may use different normalisation, tokenisation,
distance functions, score ranges and tie behaviour. Two useful engines can
therefore rank the same pair differently without either engine being broken.

Pretending that those scores are interchangeable would make an ABAP Unit test
pass or fail according to the selected database. Reproducing every detail of
HANA's linguistic engine would instead turn the portable runtime into a clone
of a proprietary and evolving subsystem. Neither outcome is acceptable.

The runtime nevertheless needs both properties:

- deterministic matching for portable ABAP Unit, CI and offline replay;
- access to a database's stronger native search where quality and performance
  matter more than byte-for-byte score identity.

The first clean-room scenario using this decision is neutral observation
catalogue reconciliation. It compares newly received observation labels and
region text with a catalogue and classifies candidates as `same_object`,
`possible_duplicate` or `distinct`. It shares no identifiers, constants,
weights, result codes or query fragments with the restricted source corpus.

## Decision

### 1. Fuzzy matching is an explicit, versioned capability

The typed IR represents text similarity as a semantic operation with a named
profile and version. It does not preserve a backend function spelling as the
meaning of the operation.

Every executable profile specifies at least:

- input type and treatment of SQL `NULL` and blank text;
- Unicode data version, normalisation form, case mapping, locale and collation;
- tokenisation, if any;
- similarity or distance rule;
- exact numeric score representation, range and rounding;
- classification thresholds;
- primary and deterministic secondary ordering keys.

An unknown profile or an unsupported option is refused before database I/O.

### 2. `portable-deterministic` has exact cross-backend semantics

The portable profile is deliberately small and completely specified by OSG.
Its normative oracle is a side-effect-free reference evaluator shipped with
the profile specification. Native HANA fuzzy search is not that oracle. For
this profile, the reference evaluator, HANA compatibility SQL, DuckDB and every
later backend must return the same normalised value, score, classification and
deterministic ordering for the published conformance corpus.

This profile is the default for:

- ABAP Unit and repository regression tests;
- CI and offline replay;
- examples whose expected result contains an exact score;
- differential testing of the SQLScript parser, IR and lowerers.

A backend may implement the profile with native functions or compatibility
SQL, but only after exact differential cases prove equivalence. Otherwise it
must refuse the capability; it must not substitute a merely similar matcher.

The concrete normalisation and score formula will be accepted by a separate
measured profile specification. This ADR chooses the compatibility model, not
an unmeasured formula.

### 3. `native-fuzzy` has a behavioural quality contract

The native profile deliberately permits engine-specific scores. HANA may use
HANA fuzzy search and DuckDB may use a suitable native extension or function.
The numeric scores do not have to be equal across engines and are not portable
application data.

Each native profile identity is backend-qualified. Its immutable registry
entry includes the database engine, an optional supported version range,
extension or native implementation version, relevant configuration and
collation, profile parameters and synthetic corpus hash. Eligibility by range
is not qualification: every admitted engine build/revision is tested and
recorded exactly; an unqualified build refuses the profile. A materially
different implementation is a new qualification, even when its human-facing
profile name is unchanged.

Compatibility is evaluated over a versioned synthetic corpus through
behavioural invariants and aggregate quality gates, including:

- exact and canonical-equivalent matches rank at or near the top;
- controlled degradations do not improve the match unexpectedly;
- clearly unrelated pairs remain below the acceptance threshold;
- expected candidates appear within the configured top K;
- precision, recall and false-positive bounds meet the profile's published
  limits;
- ties are made deterministic with OSG-owned secondary keys.

Thresholds and quality limits are profile-version data. They must be measured
and checked per backend; they are not inferred from similarly named database
functions. A backend that misses a gate is reported as unsupported for that
profile version.

Qualification data is frozen before acceptance. The registry entry identifies
the candidate universe, queries, gold relevance labels, corpus split and hash,
metric formulae, aggregation rule, K values, threshold values and how a tie at
the K boundary is counted. Calibration uses the designated calibration split;
the pass/fail decision uses a held-out acceptance split. Limits may not be
retuned after observing that acceptance result without creating a new profile
qualification and a new held-out split.

`native-fuzzy` is intended for interactive search, demonstrations and
production-like quality/performance experiments. Unit tests may assert its
classification and corpus-level quality contract, but must not assert that a
HANA score equals a DuckDB score.

### 4. Results disclose their profile and engine

Execution results and the AMDP progress report carry the requested profile,
profile version, actual backend, exact runtime engine version/build, extension
or native component version, frozen implementation configuration and whether
the implementation was native or compatibility-lowered. The UI must not
display a native score as though it were comparable with a score produced by
another profile or engine.

Stable decisions derived from native matching must store the classification
and the complete qualified profile identity: profile version, backend,
exact runtime engine build, extension/native component version and relevant
configuration. They must not reinterpret an undocumented raw score later. Raw
native scores may be kept as diagnostic evidence with that same identity.
Portable decisions need the portable profile version and reference-evaluator
version.

### 5. Native HANA remains an oracle, not the universal definition

HANA is the native execution oracle for SQLScript control and relational
semantics, and its labelled corpus results qualify the HANA native profile. It
does not define the portable fuzzy formula or the numeric scale of another
native matcher. Every backend implementation of `portable-deterministic`,
including ordinary SQL executed on HANA, is compared exactly with OSG's
normative reference evaluator. Native HANA fuzzy participates only in its
backend-qualified behavioural profile unless it is separately proven exactly
equivalent to the portable profile.

## Consequences

- Portable unit tests remain reproducible across databases.
- Native engines can expose useful search quality without false claims of
  score equivalence.
- The IR and capability registry gain profile identity and versioning rather
  than a generic `fuzzy=true` flag.
- Conformance has two visibly different verdicts: exact semantic equality for
  the portable profile and statistical/behavioural acceptance for a native
  profile.
- The demo can compare HANA and DuckDB honestly: exact values in portable mode,
  and quality metrics plus backend-labelled scores in native mode.
- Adding a backend requires either an exact implementation of the portable
  profile, a separately measured native profile, or an explicit refusal.
- Profile revisions are compatibility changes. Existing expected results stay
  tied to their original version until deliberately migrated.

## Alternatives rejected

- **Require identical native fuzzy scores from all databases.** This couples
  portability to undocumented engine details and rejects useful implementations
  for cosmetic numeric differences.
- **Treat all similarly named similarity functions as equivalent.** Their
  normalisation, distance and scale differ; the resulting green test would be
  misleading.
- **Clone the whole HANA linguistic engine.** This is far beyond the portable
  AMDP objective and would still be difficult to validate and maintain.
- **Accept approximate results in every test.** This makes failures
  non-reproducible and weakens ABAP Unit precisely where it must be strict.
- **Sort by native score alone.** Equal scores can then produce unstable output
  and flaky top-K tests.

## One-line summary

OSG provides one small, exactly reproducible fuzzy profile for portable tests
and separately measured native profiles for search quality; native scores may
differ, but classifications, quality gates and tie ordering remain explicit.
