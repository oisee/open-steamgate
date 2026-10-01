# DSL L1: the typed generation model

Status: MPC class rendering implemented through slice 5, recipes as build units (`dsl build`) in slice 11, 2026-09-30. Built on the template engine of `docs/abap-templates.md` (L0, PR #266).

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
| `xml` | rendered document is well formed XML (no schema check) |

Counts are ABAP characters (UTF-16 code units), as the engine already counts.

## Filters that know types

Built: the `literal` filter of `ZCL_OSD_TPL` (`docs/abap-templates.md` has its type table).
`{{x | literal}}` writes the value of `x` as an ABAP literal in the form its DDIC type needs, and
refuses (with template and line) a value that does not fit the type. The type is read from a
sibling `x@type` object (`built_in`, `length`, `decimals`) in the data, never from the value's
text; a value without one is an error, not a fallback. Filters apply left to right to the text,
and `literal` uses the original value's type.

The ABAP L1 model writes `value@type` for literal constant values and `default@type` for literal
parameter defaults. It reads data-element DDIC names where available and otherwise uses the
resolved built-in type. Packed lengths are converted from bytes to DDIC digits. A constant
reference or expression is `value_expr` without `value@type`; a type the filter cannot accept has
`literal_type: {resolved: false, reason}` and no `@type`. The display `@type` keeps its own shape.
`recipes/abap-constants/template.tpl` renders the literal constants through the filter with a
trace for every output line. `node tools/dsl-abap.mjs render-constants <source> --ddic <folder>
--class <name>` prints the rendered text and trace as JSON.

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

## Generated regions

A generated region inside a hand-written ABAP file names its recipe and its source in its own
markers, so one command can regenerate every region of a tree without a table kept elsewhere:

```abap
    " osd:gen r1-lookup-enrich from=before begin
    ...rendered text, indented like the begin marker...
    " osd:gen r1-lookup-enrich end
```

`<recipe>` is a folder under `recipes/` with a `template.tpl`; `from=` names the method of the
same class (found through abaplint's structure) that the recipe's model is read from. The recipe
registry in `tools/dsl-regions.mjs` (`RECIPES`) says how each recipe builds its model; today only
`r1-lookup-enrich` (the `tools/lift.mjs` model of `from=`).

- `node tools/dsl-regions.mjs check <path>...` regenerates every region in the `*.abap` files under
  the paths (model, then `ZCL_OSD_TPL`, so `npm run transpile` first) and compares byte for byte:
  one line per region, `ok`, `DRIFT` with the first differing line, or `REFUSED` with the
  recipe's refusal. The canonical body ends every line like the begin marker line, so a line
  with another ending is `DRIFT` ("line ending") and `check` and `write` agree byte for byte. Exit 1 on any drift or refusal, 0 otherwise.
- `write <path>...` rewrites the drifted regions in place, and only them; every byte outside them
  is copied as read (bytes, not decoded text, so an invalid UTF-8 byte survives), and each line
  keeps its own ending (mixed LF/CRLF files are read line by line).
- `--trace` prints per region the file line of each generated line, its template line and the
  model path it read.
- A marker behind code on the same line, unbalanced, nested or malformed markers, an unknown recipe, a missing `from=` or a `from=` the
  class does not have are errors with file and line (exit 2).

`test/dsl-regions.mjs` covers each of these; `test/lift-r1.mjs` reads its regions through the
same parser (`region(source, from)`).

## Recipes as build units

A recipe is a folder under `recipes/` with a `recipe.json`, and `node tools/dsl-build.mjs` (`npm run
dsl:build`) builds it the way a class is built: compiled, linked, checked, with the error at build time
and `<recipe>/<file>:<line>` in it.

```json
{"template": "template.tpl", "partials": {"name": "file.tpl"}, "model": "abap-methods",
 "profile": "text", "schema": "schema.json"}
```

`model` names the provider, a small registry in `tools/dsl-build.mjs` (`lift-r1`, `abap-methods`,
`abap-constants`, `json-file`) that maps it to the function building the model and to its sample input(s): the R1
demo class for `lift-r1`, a `sample/` folder beside the two ABAP recipes, and JSON samples beside the daemon recipes. `profile` is `abap`, `sqlscript`, `text` or `xml`. `schema` is the model's shape: `"scalar"`, `{"object": {field: shape}}`, `{"array": shape}`.

| step | what it does |
|---|---|
| compile | parses the template and every partial with the engine's grammar: a tag never closed, an empty or blank-containing name, a close without or of the wrong open, a section not closed, an unknown filter or a bad `pad`/`lower`/`literal` argument, a partial argument that is not `name=path` |
| link | resolves `{{> p}}` by name against `partials` (missing and cyclic are errors) and every tag name against the schema **in its section context**: sections push the array item or the object, a dotted name finds its first part in the nearest frame that has it (as the engine does), `.` is the context, `@index`/`@first`/`@last` need a loop around them, a partial is linked in the context of each caller with its arguments as aliases, and `x \| literal` needs `x@type` beside `x`. A miss is `recipe/template.tpl:3: {{name}} is not a field of classes[].constants[]` |
| render | builds each sample model, renders it through `ZCL_OSD_TPL` (partials handed in), runs the profile over the result; an engine refusal or a profile error carries the template, the template line and the model node from the trace |

`--check` adds the schema drift check: the schema is the union of the shapes of the provider's real
output on its samples, committed as `schema.json`, and the check fails on a field the output has and the
schema lacks, on a field the schema has and the output never produces, and on a field of another shape.
So the schema can neither fall behind the provider nor carry a field nobody writes. After a provider
change, `node tools/dsl-build.mjs schema <recipe> --write` rewrites it and the diff is reviewed. `--static`
stops after link (no runtime needed); the exit status is 1 on any error.

**The scanner is a reimplementation, on purpose.** The engine's parse is private and runs only inside a
render over data, and a build step that needs the transpiled runtime to read a template's syntax cannot
run before the transpile. The tag scanner (about 80 lines) is therefore in JavaScript, and
`test/dsl-build.mjs` holds it to the engine: sixteen refusal cases are rendered through `ZCL_OSD_TPL`
and must be refused with the same line and text, what the engine renders must compile, and every
recipe's template renders over its samples. One difference is deliberate: the engine checks a filter or
a partial only where it renders one, the build checks every tag, and a partial that is not declared is an
error here where the engine prints nothing. A declared partial that nothing calls is linked on its own
(missing and cyclic references are errors; its names are checked against the model root, and the message
says so) and reported as a warning.

**Where it runs.** Not inside `npm run transpile`: the render step needs the transpiled
`ZCL_OSD_TPL`, and the generators of that step run before it exists. It is `npm run dsl:build` and the
suite `test/dsl-build.mjs` (listed in `test/suites.d/infra-misc.json`), which CI runs with every other
integration suite, so a recipe that stops building fails the tag's tests.

## Daemon channel files (D via L1)

Stage 1 renders whole SAMC and SAPC XML files from hand-written JSON L1 models in
`recipes/samc-xml/sample/` and `recipes/sapc-xml/sample/`. `node tools/dsl-samc.mjs render
<model.json> --out <file>` writes XML and a line trace sidecar; `check <model.json> <target.xml>`
reports the first differing line. `dsl-build --check` compiles, links, renders and validates the
recipes. The SAMC sample is byte-identical with abapGit's own serialisation, captured on A4H on
2026-10-01 (deserialize the hand-prepared `zosd_t_amc.samc.xml`, call `zcl_abapgit_objects=>serialize`,
delete, in one run; saved as `docs/probes/abap-daemons/zosd_t_amc.serialized.samc.xml`). The capture
showed three things the deserialize input hid: a UTF-8 BOM at the start of the file, channels sorted by
CHANNEL_ID whatever the input order (authorities keep NR order), and a report program's PROGRAM_ID bare
while classes are padded with `=` to 30 plus `CP`. The BOM is the first character of each template (one
place, so `check` compares bytes including it); the sort is a derived fact in the model builder, not in
the template. The SAPC template carries the BOM too, because every abapGit XML file in the
vibing-steampunk tree, its `*.sapc.xml` included, starts with one; its target `src/apc/` file now
does as well, and its layout is still real-shaped rather than captured.
Authority numbers are explicit in the model; the model builder validates or computes `program_id`
from each authority's `kind` (`class` by default, `report`, or `function_group`) and derives SAPC's
XML state flag. The engine escapes XML text.

Stage 2 will derive the model from ABAP plus a declared `<app>.samc.decl.json` overlay beside
the code. The template will continue to render only decisions already recorded in the model.

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
