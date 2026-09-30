# An ABAP template engine with a traceable output

*Design note, 2026-09-30, branch `feat/abap-templates`.*

`ZCL_OSD_TPL` (`src/tpl/`) renders a Mustache-style template over a JSON tree (`zif_ajson`) into
lines of code, and gives every output line a **trace entry**: the template, the template line and the
data path it came from. It is plain ABAP, so the same class runs in `npm test`, in OSGo and on a
system through abapGit. Unit tests sit beside the class (`zcl_osd_tpl.clas.testclasses.abap`, 29
methods), as `src/regression/` does.

## Why

Generating ABAP from a model is the last step of every generator in this tree: segw-gen,
stg-compile, the SEGW generator in ABAP (`zcl_stg_segw_gen`, 1901 lines of string concatenation), and
the generation DSL of verified lift (`docs/verified-lift.md`). What the generators lack is a way to
say, for a line of output, **where it came from**. Without that, a diff between a regenerated object
and the one on a system is a list of lines, not a list of causes.

SAP ships a template engine of its own, the Code Composer: object type `CMPT`, which abapGit
serializes ([abapGit#888](https://github.com/abapGit/abapGit/issues/888)), rendered by
`CL_CMP_COMPOSER`, a class marked for SAP-internal use
([se80.co.uk](https://www.se80.co.uk/sap-oop/?class=cl_cmp_composer)). Its language was measured on
A4H with our own templates (a local corpus of 54 cases); supporting that syntax is parked as ideas
T22, and the core below keeps room for it. Our engine has no SAP dependency and runs on a system as
an ordinary Z class.

## Measured before building

`sbcgua/abap_mustache` (MIT) runs here as a scratch pack: 21 of its test methods passed after two
workarounds, which are upstream defects now in `ANORMALIES.md`
(`ANOMALY-2026-09-30-macro-argument-dollar`, abaplint/abaplint#4342;
`ANOMALY-2026-09-30-concatenate-lines-string-trim`, abaplint/transpiler#1935). Writing our own
engine found a third (`ANOMALY-2026-09-30-find-section-length`). abap_mustache lacks the trace, and a
trace belongs inside the renderer, not around it.

## The language (built)

| construct | meaning |
|---|---|
| `{{name}}`, `{{a.b}}`, `{{.}}` | value; a dotted name finds its first part in the nearest frame that has it, then walks down |
| `{{{name}}}`, `{{& name}}` | value, never escaped |
| `{{#x}}...{{/x}}` | array: once per item; object or other truthy value: once, with `x` as the context |
| `{{^x}}...{{/x}}` | when `x` is missing or false |
| `{{! ...}}` | comment |
| `{{> p}}` | partial, indented by the blanks in front of a standalone tag |
| `{{> p name=path ...}}` | partial with arguments: `name` resolves to `path` inside the partial |
| `{{@index}}`, `{{#@first}}`, `{{^@last}}` | the nearest loop: 1-based index (like `sy-tabix`), first and last item |
| `{{name \| lower}}`, `\| upper`, `\| pad 20` | filters, applied left to right; an unknown filter is an error |

A section, inverted, close, comment or partial tag alone on its line takes the line with it, newline
included (the Mustache "standalone" rule, judged on the source, so it holds for consecutive lines and
CRLF). The final newline of the output is kept (`ty_result-final_newline`).

Errors (`ZCX_OSD_TPL`) name the template and the line: `main:2: section a not closed`,
`r:1: partials nested deeper than 50`, `main:1: unknown filter "shout"`.

### Deviations from the Mustache specification, on purpose

- No HTML escaping by default: code must not be escaped (`iv_escape = c_escape-html` turns it on).
- A blank line of an indented partial stays empty, so generated code carries no trailing blanks.
- `@index` is 1-based.
- Truthiness is JSON's: `false`, `null`, `[]` and `""` are false, `0` is true.
- Not supported: lambdas, inheritance, dynamic names, set-delimiter.

## The trace

`ty_result-trace` has one entry per output line: `line`, `template` (a partial is its own template),
`template_line`, `path`. The first text on a line opens its entry and gives the template line; the
first **value** on the line names the path, so `  METHODS {{name}}.` traces to `/methods/2/name`. The
pieces of a multi-line value all keep the line of their tag.

## Planned, not built

- **Profiles** per target language: `abap` (7-bit ASCII, line length at most 255, no trailing
  blanks, comment prefix `"`), `sqlscript` (`--`), `text`; a violation is an error with its trace entry.
- **Regions**: rendered blocks wrapped in marker comments, so a hand edit inside one is detectable.
  SAP's composer does the same for its slots (measured), which suggests the marker shape.
- **The trace as a JSON sidecar** written beside generated objects.
- **Mustache spec conformance** (github.com/mustache/spec, MIT; modules comments, interpolation,
  sections, inverted, partials) with the HTML escaper, deviations listed.
- **Type-aware filters**: the generation DSL resolves DDIC and class types in its model; a filter can
  then write, for example, an ABAP literal in the form the field's type needs.
- The first user: a regenerated SEGW class compared byte for byte with `zcl_stg_segw_gen`'s output.

## Probes, erased at compile time

Tracing code in a generated program is ordinary template text in a section on a render option:
`{{#trace.section}}...{{/trace.section}}`. With the option off nothing is rendered, not a disabled
probe. A unit test renders both and compares.

## Determinism

The same template and data give the same bytes: no clock, no user, no system name in the output;
sections iterate in data order, arrays by index. A unit test renders twice and checks the exact value.
