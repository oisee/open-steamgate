# DSL L1: the typed generation model

Status: MPC class rendering implemented through slice 5, 2026-09-30. Built on the template engine of `docs/abap-templates.md` (L0, PR #266).

## Where it sits

Generation here is layered, and every generated line keeps its provenance through all of them:

| layer | what it holds | where |
|---|---|---|
| L0 text | templates, logic-less; every output line knows template, template line, data path | `src/tpl/zcl_osd_tpl` |
| **L1 typed model** | the things generated *about*: entity types, properties, keys, their DDIC and class types, signatures. Every decision the output depends on is made here | this spec |
| domain layers | a domain language (rules, cohorts, runs) that compiles to L1 models | outside this repository |

The rule between L0 and L1: **the template renders, the model decides.** A template holds no
conditions beyond sections over values the model already computed. If an output depends on a
type (a literal's form, a length, whether a setter is called), the model resolves the type and
states the result; the template prints it.

## Model

A model is a JSON tree (what `zcl_osd_tpl` reads through `zif_ajson`) with two additions over
plain data:

- **node ids.** Every object that a template section iterates over or reads from carries `@id`, a
  stable path-like id (`entity/Travel/property/TravelId`). The trace uses it.
- **resolved types.** A property that stems from the DDIC carries `@type`: the built-in DDIC type,
  length, decimals and, where it came through one, the data element. Types are resolved by
  **providers** behind one interface (the shape `tools/lift.mjs` uses for keys): DDIC through
  abaplint first; CDS next; a database catalog later. A provider answers, declines ("not mine"), or
  refuses with the reason; an unresolved type is carried as unresolved, never guessed.

Derived facts are computed in the model builder and written as plain fields
(`setters.creatable = true`, `max_length = 20`), not left for the template to work out.

## Profiles

A profile is the target language's rules, checked on the rendered text with the trace in hand, so
a violation points at the template line and the model node that caused it.

| profile | checks |
|---|---|
| `abap` | line length at most 255; no trailing blanks; comment prefixes `*` and `"`; identifiers 7-bit ASCII (error); non-ASCII in a comment or literal is a warning, an error under `strict` |
| `sqlscript` | comment prefix `--`; the same identifier and character rules |
| `text` | none beyond the engine's own |

Counts are ABAP characters (UTF-16 code units), as the engine already counts.

## Filters that know types

Built: the `literal` filter of `ZCL_OSD_TPL` (`docs/abap-templates.md` has its type table).
`{{x | literal}}` writes the value of `x` as an ABAP literal in the form its DDIC type needs, and
refuses (with template and line) a value that does not fit the type. The type is read from a
sibling `x@type` object (`built_in`, `length`, `decimals`) in the data, never from the value's
text; a value without one is an error, not a fallback. Filters apply left to right to the text,
and `literal` uses the original value's type.

Today the caller supplies `x@type`; the tests build it by hand. Writing it from the resolved DDIC
type into the L1 model beside each value a template may print as a literal is the model's next
step, and until then no model does.

## The trace as a sidecar

`render` already returns a trace per output line. L1 writes it next to the generated object as
`<object>.trace.json`:

```json
{"generator": "segw-mpc-entity", "template": "mpc_entity.tpl", "model": "sha256:...",
 "lines": [{"line": 12, "template_line": 7, "path": "/properties/2/name",
            "node": "entity/Travel/property/TravelId"}]}
```

`node` is the nearest enclosing `@id` on the data path. A consumer of the generated code (a
reviewer, a diff after regeneration, an alert that must say which rule made it) goes from a line
to the model node in one lookup.

## First consumer: one MPC method, byte for byte

`zcl_stg_segw_gen` builds the `DEFINE_<entity>` method of an `_MPC` class by string concatenation
(`define_entity_method`, `property_code`). The first L1 consumer renders the same method from a
template over a model built from the same project tree, and the test compares the two texts
**byte for byte** for every entity type of every project the SEGW tests already use.

Why this one: it has sections (properties, entity sets), optional lines (key, label, precision,
max length, semantics, etag, media), a complex-property variant, and fixed formatting quirks that
only a byte comparison notices (two spaces before a label's comment). It is small enough to finish
and real enough to fail.

Acceptance:
1. equal text for every entity of every fixture project;
2. every output line has a trace entry with a `node`;
3. the `abap` profile passes on the output;
4. a mutation test: changing one model field changes exactly the lines whose trace names that node.

Not in the first slice: the other MPC methods, DPC, the class frame, writing files.

## Whole MPC class

`zcl_osd_dsl_mpc=>render_class` renders the full `_MPC` class from the project
model. The model fixes the type-block placement, constant and method-declaration
order, optional sections, and alphabetical implementation order. The class
template includes the method templates as partials, so the line trace reaches
the section or property that produced each line. Complex properties carry a
resolved `@type` with their own `@id`, as entity properties do.

After `npm run transpile`, run
`node tools/dsl-mpc.mjs render <project.iwpr.xml> --out <dir>` to write the
class's `.clas.abap` and `.clas.trace.json` files. The command imports under its
own temporary project name, removes those rows afterwards, prints the ABAP
profile findings, and exits nonzero for an error finding.

## Steps

1. Model builder for one entity type out of the project tree (the rows `zcl_stg_segw_gen`
   reads), with `@id` and resolved setter flags; ABAP, 7.02, beside the generator.
2. `mpc_entity.tpl` and the byte comparison test (ABAP Unit, fixture projects).
3. Trace sidecar: `node` per line; mutation test (acceptance 4).
4. `abap` profile check on the rendered text, with trace positions.
5. Type-aware filter `literal` with its tests, used where the template writes a literal.

Each step: a critic on the diff, fixes with tests that fail without them, then the next.

## Open questions

- The provider interface is JavaScript in `tools/lift.mjs` today and would be ABAP here. One
  contract, two implementations (as `tools/segw-gen.mjs` and `zcl_stg_segw_gen` are), or the model
  built only in ABAP?
- Where a sidecar lives for an object deployed through abapGit: beside the source in the repo, or
  only in the generator's output.
