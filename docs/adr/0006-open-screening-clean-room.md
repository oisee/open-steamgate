# ADR 0006 — Screening rules in the open, as a clean room

**Status:** Proposed; waits for Alice's explicit accept (osg-research-c2, 2026-09-30, at Alice's request; reviewed by dell: accept with changes, all folded in). Until Alice accepts, nothing screening-related lands in open-steamgate.
**Date:** 2026-09-30
**Deciders:** Alice; open-steamgate (dell, osg-research-c2)
**Context:** The DSL track (`docs/dsl-l1.md`, L2 in `docs/dsl-l2.md` once it lands) has a
public first rule on a toy fleet domain. Alice asked whether screening, in the sense of SAP
Business Integrity Screening (BIS), can also be built in this repository, since BIS is a
published SAP product: rules written against Z wrappers instead of SAP classes, over tables whose
shapes are public. Until now all screening work lived in a private repository, fed one way only
(public → private), because it was learned on private material.

## Context

Three things are true at once:

- **BIS is public as a product.** SAP documents its concepts on help.sap.com: detection
  strategies, detection methods, rules, parameters, alerts, scoring. A rule language, an engine
  that evaluates rules, alerts with an audit trail, and orchestration around them can be designed
  from that documentation alone.
- **The private corpus is not public, and never will be.** Its rules, thresholds, data, object
  names, and anything a person learned by reading them stay private. Renaming does not make a rule
  clean: a rule written while looking at a private rule is a derived work. `CLAUDE.md` already applies this to the SAP-delivered corpus ("no names in tracked
  files unless public SAP documentation or abapedia.org shows them"), and the private repository's
  own rule is stricter: nothing leaves it.
- **The machinery is ours either way.** L0–L2 (engine, typed model, trace, profiles, `literal`,
  regions, `dsl build`, the rule compiler) and an L3 for orchestration, piping, parallel execution
  and an audit trail do not depend on any private rule. They are built here already.

## Decision

0. **Whether a public screening track exists at all is Alice's decision.** This ADR describes the conditions if she accepts it.
1. **A public screening track is a clean room.** Its rules, examples, tables and tests are written
   only from public sources: SAP's published BIS documentation (cited by URL), abapedia.org for DDIC
   shapes, and our own synthetic data. It lives under its own paths (`src/screening/`,
   `test/screening/`, `docs/screening/`), which the leak scan always covers.
2. **Public → private is allowed; private → public never**, including paraphrase, structure and
   numbering. The public track does not read, quote, paraphrase or "sanitise" private material; the
   private side may use the public machinery.
3. **Who writes the public rules.** A session that has read any private screening material,
   including summaries or syntheses of it, never authors public screening specs; it may review them for leaks
   only. This rules out the sessions that drafted this ADR. Authors are fresh sessions whose only
   inputs are the public sources named in the spec.
3a. **Every public spec carries a `sources:` header** (URLs, abapedia links). The critic checks
   that each rule, threshold and example traces to a listed public source or is marked synthetic;
   "from memory" is refused.
3b. **Synthetic data does not mirror the private corpus's structure**: no matching rule
   numbering, thresholds or naming patterns, even where plausible. The leak reviewer checks
   resemblance, not only literal names.
4. **SAP objects are reached through Z wrappers, as the Gateway is.** A rule calls
   `ZIF_OSD_SCR_*` interfaces that we define and implement (clean room, MIT), exactly as
   `/IWBEP/` is reimplemented at the interface level. On a system, a wrapper may delegate to the
   standard; here, it runs on our tables. No SAP source is copied.
5. **Names.** A BIS table, class or function module is named in a tracked file only when public SAP
   documentation or abapedia.org shows it, with the link, per `CLAUDE.md`. Otherwise it is
   described by its shape (fields, types) under our own `ZOSD_SCR_*` name.
6. **Enforcement is a tool, not attention.** The leak scan (`npm run leak`) matches the
   gitignored identifier list, which today carries hosts, users and the SAP sandbox corpus but
   **not** the private corpus's names (checked 2026-09-30). Before the first public screening
   rule lands, Alice adds the non-public rule, object and namespace names to that list on every
   machine that commits to open-steamgate, moving the file machine to machine by rsync/ssh, never
   through git, chat or a public link; no session adds names it has not been given that way. CI
   cannot read a gitignored file, so enforcement in CI needs one of two choices, both Alice's:
   (a) an encrypted Actions secret that `leak-scan.yml` writes to `.local/` at run time, which
   places the names in GitHub's secret store; or (b) enforcement only in the pre-push hook on our
   machines. Until one is chosen, this ADR claims no CI scan. A public screening PR is also gated
   by the usual critic, whose prompt asks explicitly for private-material leakage and resemblance.
7. **What stays private, explicitly:** the private corpus's rules and their logic, thresholds, data,
   results, object names and namespaces, the systems they run on, and any comparison of the public
   engine against them. A behavioural comparison, if ever needed, happens in the private repository
   against private oracles and its results stay there.

## Consequences

- The DSL's L2 and L3 can be developed and shown on screening, a domain people recognise, not
  only on a toy.
- The public examples are synthetic and generic by construction; they will be simpler than a real
  production rule set. That is the price of being publishable.
- Two sessions' knowledge now matters: who has read what. The specification header records it.
- The private repository keeps its own, stricter rule. This ADR does not relax it; it opens a
  separate, clean door on the public side.

## Rejected, with the reason

- **Publishing sanitised private rules** (renamed objects, changed thresholds). A derived work
  stays derived; renaming hides the source from a reader, not from the owner.
- **Keeping all screening private.** The machinery is general and already public; hiding the
  domain examples would keep L2/L3 on toys and gain no protection, since nothing private is in them.
- **Calling SAP BIS classes directly from public rules.** It ties the public track to SAP code
  that is not ours and cannot run here; the wrapper line is the same one the Gateway draws.

## One-line summary

Screening may be built in the open from public SAP documentation and synthetic data, through our
own Z wrappers, with the private repository still closed in both directions except public →
private, and the separation enforced by the leak scan and the critic rather than by memory.
