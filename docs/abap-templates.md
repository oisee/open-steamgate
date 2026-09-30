# An ABAP template engine with a traceable output

*Design note, 2026-09-30, branch `feat/abap-templates`.*

**Built** (`src/tpl/zcl_osd_tpl.clas.abap`, 12 unit tests): the tokenizer with line numbers, the standalone
rule, sections over arrays and objects, inverted sections, comments, partials with indentation, dotted
names, the HTML escaper as an option, errors naming template and line, and the trace (one entry per output
line: template, template line, data path). **Not built yet:** the profiles, regions, the JSON sidecar for
the trace, and the Mustache spec conformance run.

## Why

Generating ABAP from a model is the last step of every generator in this tree: segw-gen, stg-compile, the
SEGW generator in ABAP (`zcl_stg_segw_gen`, 1901 lines of string concatenation), and the generation DSL
discussed for verified lift (`docs/verified-lift.md`). The step itself is easy. What the generators do not
have is a way to say, for a line of output, **where it came from**: which template line and which node of
the model. Without that, a diff between a regenerated object and the one on a system is a list of lines,
not a list of causes.

SAP has a template engine: the Code Composer (object type `CMPT`, class `CL_CMP_COMPOSER`, check
transaction `CMP_CHECK`); BIS generates its mass-detection classes with it, and abapGit serializes `CMPT`.
It is marked for SAP internal use, its syntax is not documented publicly, a template can only be tried on
a system, and it has no notion of a trace. It stays a source of knowledge, not a dependency.

## What was measured

`sbcgua/abap_mustache` (MIT, 2017-2023, ~1000 lines) was built as a scratch pack under `npm run unit`
(2026-09-30): 21 of its test methods ran and passed after two workarounds and two disabled tests. The
workarounds are two upstream defects, now in `ANORMALIES.md`:

- `ANOMALY-2026-09-30-macro-argument-dollar` (abaplint, fixed in abaplint/abaplint#4342),
- `ANOMALY-2026-09-30-concatenate-lines-string-trim` (runtime).

The disabled tests need method-parameter RTTI and user date formats
(`ANOMALY-2026-09-30-write-date-unformatted`), neither of which a generator should use.

So a Mustache engine runs here. It still lacks the trace, the target-language rules and the probes below,
and those belong inside the renderer, not around it.

## Decision

An own engine, small, in plain ABAP that the transpiler accepts, generic (no domain in it), MIT:

- **Mustache syntax, a subset**: `{{name}}`, `{{a.b}}`, sections `{{#x}}…{{/x}}`, inverted `{{^x}}…{{/x}}`,
  comments `{{! …}}`, partials `{{> name}}`, and the standalone-line rule of the Mustache spec (a tag alone on
  its line leaves no blank line), which is what makes generated code look hand-written. Not: lambdas,
  inheritance, dynamic names, set-delimiter.
- **No escaping by default.** Mustache escapes HTML in `{{x}}`; code must not be escaped. An escaper is a
  parameter, and the spec conformance run uses the HTML one.
- **Data is a JSON tree** (`zif_ajson`, already a library of this tree). The model a generator renders is
  JSON anyway (YAML in, a typed IR, JSON to the renderer), and ajson keeps member order, which determinism
  needs.
- **The same classes run in three places**: in `npm test`, in the binary/extension, and on a system
  through abapGit. One implementation, no JavaScript twin.

## What the renderer returns

Not a string: a table of output lines, and for each line a **trace** entry:

| field | meaning |
|---|---|
| `line` | output line number |
| `template` | template name (a partial counts as its own template) |
| `template_line` | the line in that template the text came from |
| `path` | the data path the innermost section and the value came from, e.g. `/methods/2/name` |

The trace is written beside the output as JSON when asked. A drift check that compares a regenerated
object with the one on a system then reports, per differing line, the template line and the model node.

## Target-language profiles

A profile checks and shapes the output, it does not change the template language:

- `abap`: 7-bit ASCII only (an em dash in a comment has already broken a lint), line length at most 255,
  no trailing blanks, comment prefix `"`;
- `sqlscript`: comment prefix `--`, same ASCII and trailing-blank rules;
- `text`: none.

A profile violation is an error with the output line and its trace entry, not a warning.

Optional **regions**: the profile can wrap a rendered block in `"@gen begin <id>` / `"@gen end <id>`
comments, so a later edit inside a region is detectable, and a hand-written region between them is declared
rather than drifted.

## Probes, erased at compile time

Tracing code for a generated program (entry, exit, branch probes) is ordinary template text inside a
section on a render option: `{{#trace.section}}…{{/trace.section}}`. With the option off the section renders
nothing, so the generated program has no probe code at all, not a disabled one. A test renders the same
template with the option on and off and checks that the off output equals the on output minus the probe
lines.

## Determinism

The same template and the same data give the same bytes: no clock, no user, no system name in the output
(the BIS generator writes the generating user and time into every method; this one does not), sections
iterate in data order. A test renders twice and compares.

## How it is tested

1. Unit tests in `test/unit/`, run by `npm test`.
2. **Conformance** with the Mustache specification (github.com/mustache/spec, MIT): the modules
   `comments`, `interpolation`, `sections`, `inverted` and `partials`, run through the engine with the HTML
   escaper. Deviations are listed, not hidden.
3. The profile, trace, probe and determinism properties above, each with a test that fails without the
   feature.

## Size and order of work

Estimated 500-700 lines of ABAP plus tests. Order: tokenizer with positions -> renderer with the trace ->
spec conformance -> profiles -> probes and regions. The first user is a regenerated SEGW class compared with
`zcl_stg_segw_gen`'s output, byte for byte.

## Not in scope

A second template language, HTML rendering, logic in templates (all decisions are the model's), and running
templates stored as `CMPT` objects.
