# Deploying to a real system, through abapGit

*Measured on an A4H sandbox (7.58 / 2022) on 2026-09-19, in eight attempts.
Everything here was read off that system or off a real artefact in the
corpus; where something is inferred rather than measured it says so.*

The README's loop ends "…deploying back through abapGit". This is the last
mile of it, walked: **one YAML becomes a SEGW project, a DDIC, seed rows, a
service and a Fiori application on a system that has never seen this
repository.** The route is a zip and a person; there is no agent on the
system and abapGit's own standalone report would not activate on that
release.

What travels, in the order it was made to travel:

| level | what it added | what it proved |
| --- | --- | --- |
| 001 | the SEGW project alone | **failed** — the file names were wrong, and the failure left rows behind |
| 002 | the same, correct names | SEGW draws the tree; the service activates; `$metadata` is **8 of 8 kinds identical** with ours |
| 003 | a function import returning a primitive | SEGW does not refuse it, and the warning that said so was too strong |
| 004 | DDIC, seed rows, the hand-written `_EXT` pair | six defects in hand-written files nothing compared with anything |
| 005 | a date that is a date | the ABAP type behind `Edm.DateTime` is the model's business |
| 006 | the search help declared in the tree | **`TravelSet` answers with rows**; `StatusVHSet` answers A/O/X and `$filter` reaches the select-option |
| 007 | one seed row fewer | a client-dependent row does not survive a client-rewriting import |
| 008 | the Fiori app as a BSP application **and its ICF node** | the system serves the page |

`.local/make-level.sh <nnn>` builds one attempt; `tools/osd-bsp-app.mjs`
builds the application. Both are described at the end.

---

## Why every attempt gets its own package and its own names

The first attempt failed on a file name, and the second attempt **dumped on
the first one's leftovers**: `DBSQL_DUPLICATE_KEY_ERROR` in
`/IWBEP/I_MGW_SRG`. A half-finished import leaves registry rows, and the
next import with the same names collides with them.

So an attempt is numbered, gets its own package (`$ZOSD_004`) and its own
object names (`ZOSD_004_*`), and a failure costs nothing but a number.
`tools/osd-rename.mjs` renames a whole set by prefix — whole identifiers
only, never inside a longer word, and never inside prose.

That tool also carries a rule it learned the hard way, below.

---

## The measured constants

Everything in this section was refused by the system first.

### A versioned object name is a fixed width

abapGit names the two registration objects with the object padded and a
version appended:

```
IWSV   object padded to 35 + "0001"   = 39 characters
IWMO   object padded to 32 + "0001"   = 36
IWVB   object padded to 32 + "0001"   = 36
```

Checked against 44 real files in the corpus, and the widths **differ by
type**: taking one measurement and generalising it over the other broke a
correct fixture, which is recorded in `test/segw-corpus.mjs` as its own
case.

A prefix rename is where this is actually lost. `ZSTG_` → `ZOSD_005_` is
four characters longer, a text rename leaves the padding alone, and the name
comes out 43 instead of 39. A4H answers:

```
File not found: zosd_005_demo_srv 0.iwsv.xml
This syntax cannot be used for an object name
```

— abapGit read the object as `ZOSD_005_DEMO_SRV 0` and then could not find
the file it had just named. The width now lives once in `stg-compile`'s
`KEY_WIDTH`, and `osd-rename.mjs` re-pads.

### A BSP application name is at most 15 characters

`cl_o2_api_application=>create_new` refuses a longer one, and abapGit
reports it as `WAPA - error from create_new: 4`, which names neither the
field nor the limit. Read off the system's own source:

```abap
" cl_o2_helper=>check_application_name_valid
CALL METHOD cl_o2_helper=>split_applname ... IMPORTING p_mod_applname = l_applname.
l_namelength = strlen( l_applname ).
IF l_namelength GT 15 .
  if refuse_long_name is not initial.
    MESSAGE i170(so2_tool) raising invalid.
```

and `create_new` calls it with `refuse_long_name` defaulting to `'X'`. The
namespace does not count toward the fifteen — `split_applname` takes it off
first.

**The reason for the limit is downstream**: the name becomes an ICF node
name, and `ICFNAME` is `CHAR15`. Three independent measurements met at the
same number.

The same method also requires `APPLEXT` to equal `APPLNAME`.

### A seed row for another client must not travel

abapGit deserializes a client-dependent table into the **logon client**.
Our seed carries `MANDT 123` for the real rows and `MANDT 001` for
`T0009 / "Other client, must not leak"`, a fixture that exists to prove this
runtime does not serve another client's rows. On the system all four rows
arrived as `MANDT 001`: the fixture did not leak, it was *moved*, and a demo
on a real system answered a row labelled "must not leak".

`tools/osd-abapgit-zip.mjs` now drops rows whose client is not the file's
own and prints what it dropped. It caught a second one nobody had thought
of — the photograph of the same travel.

### A date in the TABU JSON is ISO

ajson's date rule is `^(\d{4})-(\d{2})-(\d{2})(T|$)`. A `DATS` column
written as `20260915` is refused with `Unexpected date format
@/1/flight_date`; it has to be `2026-09-15`, and `test/seed.mjs` converts
back to the internal form when it seeds here.

---

## What the generated ABAP has to get right

These are the ones a real system checks and this runtime does not.

### A generic table type is not a structure component

A SEGW-generated MPC writes

```abap
TT_BOOKING type standard table of TS_BOOKING .
```

with no key clause, which is a **generic** table type: legal for a field
symbol or a formal parameter, and illegal as a component of a structure.
A4H says so exactly. Both corpus projects that do a deep insert declare the
nested table inline **with a key**, in the `_MPC_EXT`:

```abap
TYPES: BEGIN OF ts_travel_deep.
    INCLUDE TYPE zcl_..._mpc=>ts_travel.
TYPES:
  to_bookings TYPE STANDARD TABLE OF zcl_..._mpc=>ts_booking WITH DEFAULT KEY,
  END OF ts_travel_deep.
```

and it belongs in `_MPC_EXT` because SEGW regenerates `_MPC` from the tree
and wipes whatever was added to it.

### A date is a date, and the tree says so

OData V2 has one temporal type, so a model that names only Edm types cannot
tell a date from a timestamp — and the generated component came out
`TIMESTAMP` for a column that is `DATS`. A4H refuses to activate the DPC
over it: *the data type of the component FLIGHT_DATE … is not compatible*.

SEGW says it in the tree instead. Three date properties in SAP's own sample
projects (`EPM_DEVELOPER_SCENARIO`, `S_EPM_SADL_GW_DEV_SCEN_TX`) all carry:

```xml
<EDM_CORE_TYPE>Edm.DateTime</EDM_CORE_TYPE>
<TYPE_NAME>SYDATUM</TYPE_NAME>
<TYPE_KIND>D</TYPE_KIND>
<LENGTH>8</LENGTH>
```

and **no** `PROP_PRECISION`. So `type: Date` in the YAML writes that shape.
We use `SYDATE` rather than `SYDATUM`: both are `DATS(8)`, and only `SYDATE`
is in open-abap-core and in the S/4 2022 data-element dump, so the generated
code compiles here as well as there.

The Gateway then emits `Precision="0"` itself, from the ABAP type — the tree
never asked for it. `sap:display-format="Date"`, which this runtime derives
for a DATS-bound property, does **not** appear in 38 `Edm.DateTime`
properties across 17 real `$metadata` documents nor in the live answer. That
is 39 observations and no occurrences, and it is still not enough to act on,
because all 39 may share one binding style; the case that would settle it is
a SAP-delivered service with a DDIC-bound date, and on this sandbox those
answer 403 or are not activated. See `NOTE-2026-09-19-date-facets`.

### A class may only call an interface it implements

`me->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values( … )` needs the
class to **implement** the interface; the interface existing is not enough.
This tree had that call for weeks with `npm test` green and abaplint silent
(`ANOMALY-2026-09-19-interface-call-without-interfaces`).

Where the `INTERFACES` line belongs is measured, not chosen. SAP's own
`/IWBEP/CL_GWSAMPLE_BAS_DPC`, which has value helps, declares three:

```abap
interfaces /IWBEP/IF_SB_DPC_COMM_SERVICES .
interfaces /IWBEP/IF_SB_GENDPC_SHLP_DATA .
interfaces /IWBEP/IF_SB_GEN_DPC_INJECTION .
```

and across eight corpus DPCs the first and third appear **8 of 8** times and
the second **0 of 8** — none of the eight maps a search help. So the third
is conditional on the mapping, which is what `segw-gen`'s `hasShlp` already
did. The generator was right and the **tree** was wrong: the model had never
declared the data source the hand-written code was already using. The fix is
one `operations: {query: {searchhelp: …}}` in the YAML.

### Text elements, buffering, search-help parameters

Three smaller ones, each refused by activation or by abapGit:

- a property label belongs in the class's **text pool** and is written with
  `set_label_from_text_element( iv_text_element_symbol = '010'
  iv_text_element_container = gc_incl_name )` plus a `<TPOOL>` entry. Ours
  had been an annotation the DDIC already carried, which A4H reported as
  `Attribute sap:label redefined`;
- `BUFALLOW` on a table must not be `X` without a buffering type — five
  tables were refused;
- a search-help parameter needs a data element (`ROLLNAME`), so
  `ZSTG_STATUS_SH` carries `CHAR1` and `CHAR40`.

All three have corpus-driven tests (`test/ddic-corpus.mjs`,
`test/segw-corpus.mjs`) whose rules are recounted from the corpus each run.

---

## The Fiori application: a BSP application and a door

A UI5 app on a system is a **BSP application** — one WAPA object with one
page per file. The format is read off a real one, `ZUI5_CODE_SEA` in
`.local/corpus/ui5-code-search`:

```
<app>.wapa.xml              ATTRIBUTES + one PAGES/item per file
<app>.wapa.<page>           the file; "/" written "_-", lower case
```

`PAGEKEY` is the page name upper-cased. abapGit finds a page's file by
`SPLIT pagename AT '.' INTO extra ext` and then `read_raw(extra, ext)`, so
`i18n/i18n.properties` is filed as `<app>.wapa.i18n_-i18n.properties`.

What is deliberately **not** imitated: `/UI5/UI5_REPOSITORY_LOAD` replaces
some page names with a `UI5<sha1>` hash and adds a
`UI5RepositoryPathMapping.xml` page to map them back — ten of the corpus
app's twenty-nine pages are named that way. That is the uploader's doing,
not the format's; the other nineteen are named after their file.

### The part that took the longest to find

**abapGit creates the application and the pages and does not create the ICF
node**, so the app exists and nothing serves it. `ui5_rep_dt`,
`ui5_repository`, `ui5_ui5` and `cl_ui5` appear **zero times** in abapGit's
entire source.

`/UI5/UI5_REPOSITORY_LOAD` — a 2914-line report that is a shell over
`/UI5/CL_REPOSITORY_LOAD` — does create it, because the API it drives does:

```abap
/ui5/cl_ui5_rep_dt=>create_repository( name, description, devclass, transport )
  → lock( ) → create_folder( ) / put_file( path, xstring, mime, is_binary )
  → unlock( ) → update_finished( )
```

and `/UI5/CL_UI5_REP_DT` carries the parent as a constant:

```abap
C_UI5_BSP_APP_CLSNAME type O2APPLCLAS value '/UI5/CL_UI5_BSP_APPLICATION'.
C_UI5_ICF_NODE_GUID   type ICFPARGUID value '3I2I44WJCWUB7IJYCK1741MH3'.
```

Its exception class has `ICF_NODE_NOT_CREATED` and `ICF_NODE_NOT_DELETED`
with `ICF_NODE type ICFNAME` — which is also where the fifteen-character
limit comes from.

### But the node needs no API — it is an ordinary SICF object

abapGit has no UI5-repository integration **and does not need one**. The
node of a UI5 application is a plain ICF node, and abapGit has a full SICF
object type. The corpus carries a real one — `MindsetAppAnalyzerFree`, whose
`ICF_DOCU` reads *"Deployed with SAP Fiori tools"*, i.e. a node the Fiori
tools created and abapGit serialized back:

```xml
<URL>/sap/bc/ui5_ui5/mindset/analyzer_detail/</URL>
<ICFSERVICE>
 <ICF_NAME>ANALYZER_DETAIL</ICF_NAME>
 <ORIG_NAME>analyzer_detail</ORIG_NAME>
</ICFSERVICE>
<ICFDOCU>… <ICF_DOCU>Deployed with SAP Fiori tools</ICF_DOCU></ICFDOCU>
```

**No handler.** ICF inherits a handler down the tree and the branch carries
`/UI5/CL_UI5_HTTP_HANDLER`, so the application's own node is only a name.

abapGit creates it already active, and takes the parent from the URL in the
file rather than from the file's name:

```abap
lv_parent = find_parent( iv_url ).   " cl_icf_tree=>service_from_url( url )
cl_icf_tree=>insert_node( icf_name = is_icfservice-orig_name
                          icfparguid = lv_parent
                          icfactive  = abap_true … ).
```

The file name is `<node padded to 15><first 25 hex of sha1(URL)>.sicf.xml`.
Measured on 35 real SICF files in the corpus: 33 match exactly, and the two
that do not differ only in the case of the node inside its own URL. Our
generator reproduces the corpus file byte for byte
(`analyzer_detail485dff7044481cbebcb6848d9.sicf.xml`), which is the test.

So one zip carries the application and its door, and after the import the
system answers on

```
/sap/bc/ui5_ui5/sap/<app>/index.html
```

### It serves, and the platform's own tooling does not see it

Measured after the node landed, and it is the difference between two
claims that sound the same:

```
/sap/bc/ui5_ui5/sap/zosd_008_app/index.html        200, 1326 b
/sap/bc/adt/filestore/ui5-bsp/objects/ZOSD_008_APP/content   0 entries
```

The application answers. The UI5 repository still reports no content for
it, because `put_file` writes the page **and** the repository's own index of
what the application contains, and abapGit's WAPA handler writes the page.
The BSP runtime finds a page by its key and does not need that index; the
Fiori tools, `/UI5/UI5_REPOSITORY_LOAD`'s download, and anything else that
asks the repository what is in an application, do.

So: **abapGit can deploy a UI5 application that works, and not one the
platform's own tooling can read back.** For a demo and for a system that
only serves it, that is enough. For a system where somebody will later
download, diff or redeploy it with SAP's tools, it is not, and the machine
route below is the answer rather than a nicer zip.

### Reading the system before importing

Two endpoints on the sandbox were worth more than any amount of reasoning:

- `/sap/bc/adt/filestore/ui5-bsp/objects` — the ADT deploy endpoint the
  Fiori tools use, **200** for an ordinary developer, and it lists every UI5
  BSP object on the system with its description. A UI5 app imported without
  its node appears there with **no content**, which is the symptom named;
- `/sap/bc/adt/checkruns` with reporter `abapCheckRun` — a syntax check for
  source that is **not on the system yet**. It answered the generic-type
  message for the bad class and `null` for the good one before any import.

A caution that cost an hour: `/sap/bc/ui5_ui5/` itself answers 404, because
the root has no handler of its own. That is not "the branch is missing" —
`/sap/bc/ui5_ui5/sap/arsrvc_upb_admn/` answers 200 on the same system. Probe
a **leaf**, never a root.

---

## Serving somebody else's service from here

The mirror image of deploying: a page **this** system serves, reading a
service on another one. `tools/osd-remote-service.mjs` answers a service
this registry does not have out of a destination — which is what an RFC
destination of type H is — on this origin, so the page needs no CORS and no
logon prompt. The pack `packs/travels-a4h` is that page.

A proxy on another port cannot demonstrate this. It shows that our Fiori app
can read a real Gateway; it does not show that a page this system serves
can, which is what a page on a real system does every day.

Two things it has to carry, and the second was found by a write failing:

- **the CSRF pair.** A Gateway refuses a modifying request without a token:
  the page does a GET with `X-CSRF-Token: Fetch`, gets a token **and a
  session cookie**, and sends both with the `$batch`. A proxy that drops
  either breaks it at the only moment that matters. `/IWFND/CM_MGW/098` is
  what that looks like;
- **the authorization stays ours.** The destination holds the logon, so a
  client header never overrides it.

Measured through OSD into A4H: `POST TravelSet` inside a changeset answered
**201 Created**.

---

## The tools

| command | what it makes |
| --- | --- |
| `npm run stg:compile -- <x>.stg.yaml` | IWPR + IWSV/IWMO + the four classes |
| `npm run segw:zip -- <folder> --out <f>.zip [--data <dir>]` | an abapGit offline repository; refuses a nested folder, drops other-client rows, names what it did not carry |
| `node tools/osd-rename.mjs --from ZSTG_ --to ZOSD_008_ …` | a whole object set under another prefix, re-padding the versioned names |
| `node tools/osd-bsp-app.mjs <webapp> --name <APP> --out <dir> [--service <SRV>]` | a BSP application and its ICF node; refuses a name over 15 |
| `.local/make-level.sh <nnn> [outdir]` | one numbered attempt, end to end |

The zips of one evening are eight numbered files; nothing about the route
depends on which number an attempt has.

## The launchpad, mapped but not walked

Deferred by Alice on 2026-09-19; the probing is recorded so the next session
does not repeat it. Serving a page at a URL and having a **tile** are two
different things, and the second needs the app to be discoverable.

What answers on the sandbox, for an ordinary developer:

```
/sap/bc/ui2/app_index/                         200   87 apps, keyed by sap.app/id
/sap/opu/odata/UI2/PAGE_BUILDER_PERS/          200   catalogs, groups, tiles
/sap/opu/odata/UI2/INTEROP/                    200   target mappings
/sap/bc/ui5_ui5/ui2/ushell/…/FioriLaunchpad.html  200
/sap/bc/ui2/start_up                           403   needs a role
/sap/bc/adt/filestore/…/<APP>/appindex         404   not that resource
```

**Our app is not among the 87.** The app index is built by scanning BSP
applications' `manifest.json`, and ours has what it needs already — a
`sap.app.crossNavigation.inbounds` entry (`Travel-manage`, semantic object
`Travel`, action `manage`), because the same manifest drives the launchpad
here. So the manifest is not the gap; the index has simply never been
recalculated since the application arrived.

The remaining steps, in the order they depend on each other, none measured:

1. **the app index** — `/UI2/APP_INDEX_CALCULATE` (or `/UI2/APPIDX`) picks
   the manifest up. Until then no intent resolves to it;
2. **a target mapping and a tile** — a catalog, a group, and the mapping
   from `Travel-manage` to the BSP application. That is launchpad
   customizing, not a repository object, so whether it can travel in a zip
   at all is the open question; `PAGE_BUILDER_PERS` and `INTEROP` are the
   services behind it and both answer;
3. **a role** — `start_up` is 403 for this user, so even a correct tile
   would not appear for it.

The honest summary: **the page is deployable today, the tile is not**, and
the wall between them is customizing and authorization rather than anything
this repository generates.

## What is not done

- **OSD does not serve a WAPA.** The application travels to a system as one
  object and comes back here as a folder of static files that `express`
  serves. That is the only place in this tree where the request path is not
  ABAP, and it is why the same artefact does not yet run in both runtimes.
  Serving `/sap/bc/ui5_ui5/sap/<app>/<page>` out of the object store, in
  ABAP, is the next step and it is next to G.5.
- **The deploy is a person with a zip.** `/sap/bc/adt/filestore/ui5-bsp/objects`
  answers 200 and is the machine route; nothing here speaks it yet.
- **`/UI5/ABAP_REPOSITORY_SRV`** answers 403 on this sandbox, so the OData
  route was not measured at all.
