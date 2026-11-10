# The managed RAP runtime (R2)

R2 of [the RAP plan](oracle-rap.md): a managed behavior definition runs. Its
behavior pool's determinations, validations and action are called, its
instances live in a transactional buffer until the save sequence writes them
into the persistent table, and the LUW ends in `COMMIT WORK` or
`ROLLBACK WORK`. It is served over OData V2 and V4 (reads, writes and actions) from a
service definition: see [Serving (R2c)](#serving-r2c).

```
node tools/rap/bdef-gen.mjs                  # types, adapter, registry -> gen/rap/
npx mocha test/rap-runtime-gen.mjs           # what is generated and refused
node tools/osd-unit.mjs CLAS ZCL_OSD_RAP_TEST   # after npm run transpile: both pools
```

## Decision: handler-direct, no EML

EML (`MODIFY ENTITIES`, `READ ENTITIES`, `COMMIT ENTITIES`) is **not** in R2
and R2 needs no transpiler change. The runtime calls the pool's handler and
saver methods directly. EML comes through a transpiler patch that lowers
the statements onto `KERNEL_RAP_EML` over this runtime, R2a,
[rap-eml.md](rap-eml.md); a managed slice does not need it, because only
the runtime modifies instances.

The price is the handler's contract while there is no EML: a determination or
action cannot `READ ENTITIES` / `MODIFY ENTITIES IN LOCAL MODE`, so it gets the
instances it works on as a table parameter `entities` and changes them in
place. The runtime takes the changed fields back into the buffer, where they
trigger what depends on them. When EML arrives the handlers can be written the
SAP way and this parameter goes.

**R3: handlers in the system's form.** A pool may instead declare its
methods as on a system (`FOR DETERMINE ON MODIFY IMPORTING keys FOR
Note~SetStatus`, [rap-derived-types.md](rap-derived-types.md), "Handler
declarations"). Such a method gets the keys and the response structures and
no instances; it reads and changes them through EML. Three rules make that
work, all in `ZCL_OSD_RAP_RUNTIME`:

- **EML inside a handler reaches the calling transaction.** While a handler
  runs, the runtime is on a stack (`ZCL_OSD_RAP_RUNTIME=>ACTIVE`), and
  `ZCL_OSD_RAP_EML=>RUNTIME`, which the transpiled statements and direct
  callers go through, answers that runtime rather than the session's.
- **It acts as IN LOCAL MODE.** A modification made while a handler of the
  runtime runs may set a read-only field, and it does not start a request of
  its own: the determinations it triggers run in the loop of the request
  that called the handler (on modify) or of the save (on save), each at most
  once per instance. This is an OSG convention: `IN LOCAL MODE` itself is
  still accepted and ignored ([rap-eml.md](rap-eml.md)), so an EML call
  inside a handler is treated as local whether it says so or not.
- **No take-back.** The runtime copies changed rows back only from a handler
  with an `entities` table (`ty_callable-entities`, set by the generator); a
  handler without one has already changed the buffer, and copying its stale
  rows back would undo that.

The pinned transpiler does not lower EML statements yet, so
`src/rap_demo/zbp_rap_note_sf` writes each statement as the
`ZCL_OSD_RAP_EML` call it lowers to, with the statement in a comment above
it. `test/unit/zcl_osd_rap_test` runs the same eleven-test scenario over
both pools (`ltcl_explicit`, `ltcl_system_form`); with the stack routing
removed, nine of the system form's eleven fail.

**The flight sample's determination does not run yet.** The gate set for R3
was one determination of SAP's public flight reference scenario
([abap-platform-refscen-flight](https://github.com/SAP-samples/abap-platform-refscen-flight),
commit `5353cbeb`, managed travel) compiled and run without edits. Its
handler declarations now lower (`calculatetotalprice FOR DETERMINE ON
MODIFY`, the six `FOR VALIDATE ON SAVE`, the `FOR MODIFY ... FOR ACTION`
ones), but the business object never gets that far. What blocks it, in the
order the build meets it:

1. **The BDEF.** `bdef-gen.mjs` refuses `/DMO/I_Travel_M` at its
   composition, `association _Booking { create ( features : instance ); }`
   ("associations/functions/determine actions are outside R1"). Behind it
   in the same definition:
   `early numbering`, `factory action`, `internal action`,
   `features : instance` on actions, `with additional save`, `etag master`.
2. **The pool.** Beside the determination, the same local class declares
   `FOR INSTANCE FEATURES` and `FOR NUMBERING` methods, which the lowering
   refuses by name (no derived request/result types; early numbering).
3. **The determination's body** is one statement, `MODIFY ENTITIES ... IN
   LOCAL MODE ENTITY travel EXECUTE recalctotalprice FROM CORRESPONDING #(
   keys )`: EML, which the pinned transpiler does not lower, executing an
   `internal action` the generator refuses.

So the proof here is the demo twin; the flight determination needs
compositions in R1/R2, the two refused handler forms, and the EML pin.

## The pieces

| Where | What |
| --- | --- |
| `src/rap/zcl_osd_rap_runtime` | the buffer, field control, numbering, triggers, save sequence (generic, by component name) |
| `src/rap/zif_osd_rap_bo` | one BDEF as the runtime sees it: model + typed calls into the pool |
| `gen/rap/zcl_rap_<hash>` | that interface, generated per managed BDEF by `tools/rap/rap-runtime-gen.mjs` |
| `gen/rap/zcl_osd_rap_registry` | BDEF name to adapter; the runtime creates it by name, so a tree without BDEFs still compiles |
| `src/rap/cl_abap_behavior_handler`, `cl_abap_behavior_saver`, `cl_abap_behv`, `if_abap_behv`, `if_abap_behv_message` | clean-room bases a pool inherits |
| `src/luw/zcl_osd_luw` | the delta (create/update/delete collapsed), reused |
| `src/luw/zcl_osd_luw_hold` | whether an enclosing changeset or V4 group holds the LUW (set by both batches, read by the SADL bridge) |

The model comes from the R0 JSON (`tools/rap/bdef-parse.mjs`) and the CDS
fields R1 resolves. The adapter is generated because the pool's methods are
typed with the BDEF's derived types and only generated code knows them;
everything that can be generic is in the runtime.

## API

```abap
lo_rap = zcl_osd_rap_runtime=>for_bdef( 'ZI_RAP_NOTE' ).
lo_rap->modify( EXPORTING iv_entity = 'Note' iv_operation = 'C' it_rows = lt_create
                CHANGING cs_mapped = ls_mapped cs_failed = ls_failed cs_reported = ls_reported ).
lo_rap->read( EXPORTING iv_entity = 'Note' it_keys = lt_keys CHANGING ct_result = lt_rows cs_failed = ls_failed ).
lo_rap->execute( EXPORTING iv_entity = 'Note' iv_action = 'Approve' it_keys = lt_import
                 CHANGING ct_result = lt_result cs_failed = ls_failed cs_reported = ls_reported ).
lo_rap->commit( IMPORTING ev_saved = lv_saved CHANGING cs_failed = ls_failed cs_reported = ls_reported ).
lo_rap->rollback( ).
```

The tables are the BDEF's derived types (`TYPE TABLE FOR CREATE`, `UPDATE`,
`DELETE`, `READ IMPORT`/`RESULT`, `ACTION IMPORT`/`RESULT`), the responses
`TYPE RESPONSE FOR MAPPED|FAILED|REPORTED EARLY`. An entity is named by its CDS
name or its alias. `trace( )` lists what ran; `pending( )` counts the delta.

## Behavior

Following the public RAP documentation (managed implementation type, the
[implementation contract](https://help.sap.com/docs/ABAP_PLATFORM_NEW/fc4c71aa50014fd1b43721701471913d/1040b81372d44ed38b07a409fa0e1769.html),
the save sequence); nothing measured on a system.

- **%cid / %cid_ref.** A create's `%cid` comes back in MAPPED with the key; a
  later update, delete or action in the same transaction (until the next
  successful `commit`) may address the instance by `%cid_ref`. A `%cid`
  already used in the transaction, also within one request, is refused
  (FAILED, cause `conflict`), so a reference is never ambiguous.
- **Keys** are identified by a length-prefixed rendering of the key tuple, so
  a separator inside a key value cannot make two instances one.
- **%control.** A create sets the fields whose `%control` flag is on (and the
  keys); an update changes only those. Key fields are not updated.
- **Field control.** Only `readonly`, `readonly : update`, `mandatory`,
  `mandatory : create`, `numbering : managed` (and `features`, ignored) are
  accepted; any other qualifier is refused by the generator.
  `readonly` (or `readonly : update` on update) refuses a
  flagged field: FAILED with `%fail-cause = if_abap_behv=>cause-readonly`,
  REPORTED with a message and `%element`. `mandatory` (or
  `mandatory : create` on create) must be flagged and not initial on create,
  and not cleared on update. A refused row changes nothing.
- **Numbering.** `field ( numbering : managed )` on a key of type `x LENGTH 16`
  draws a UUID on create (early). An existing key is a conflict (409).
  `early numbering` draws the key in the pool's `FOR NUMBERING` method (R4,
  below); `late numbering` is refused by the generator.
- **Determinations on modify** run after each `modify`/`execute` request for
  the instances whose trigger it touched (`create`, `update`, or a field), each
  once per instance per request; changes they make trigger other
  determinations of the same request.
- **Save sequence** (`commit`):
  1. *finalize*: determinations on save (triggers since the last save), then
     the saver's `finalize`;
  2. *check_before_save*: validations on save, then the saver's
     `check_before_save`. A validation fails an instance by adding it to
     FAILED (and REPORTED);
  3. on any new FAILED row: the saver's `cleanup_finalize`, `ROLLBACK WORK`,
     `ev_saved = false`. Nothing is written and the buffer is **kept**, as RAP
     keeps it after a failed save, for a correction or `rollback( )`;
  4. otherwise *save*: the managed save writes the delta (insert, update,
     delete) into the persistent table, each CDS element into its column from
     the BDEF `mapping for` (else the CDS base field), MANDT set from
     `sy-mandt`. An update starts from the row in the database, so a column
     the entity does not expose keeps its value. Then `COMMIT WORK`;
  5. *cleanup*: the saver's `cleanup`; the transactional buffer is reset
     (instances and content IDs), so the next transaction reads the
     database again.
  `adjust_numbers` is not called: late numbering is not supported.
- **LUW.** The runtime ends its own LUW with `COMMIT WORK` / `ROLLBACK WORK`;
  in the gateway that is inside the dialog step's bracket
  ([luw-buffer.md](luw-buffer.md)), and an exception nobody catches is rolled
  back by `tools/osd-dialog-step.mjs` as for any request. A database write
  that fails in the save raises `ZCX_OSD_RAP` after a `ROLLBACK WORK`.
  `commit( iv_end_luw = abap_false )` saves without ending the LUW: inside
  a `$batch` changeset (V2) or atomicity group / change set (V4) the batch
  holds the LUW (`ZCL_OSD_LUW_HOLD=>HELD`), `ZCL_OSD_RAP_SADL` passes that
  on, and the batch commits or rolls back the RAP save with the group, so
  a later failing member undoes a create, update, delete or action that
  had already run (`test/rap-serve.mjs`). Each operation is still its own
  save sequence (validations run per operation, not once at the end).
- **Locks and authorization** are parsed and ignored; ETags, instance
  features and early numbering are R4 (below).

## Handler methods

The generator reads the pool with abaplint's parser: local classes inheriting
`CL_ABAP_BEHAVIOR_HANDLER` (one per entity) and `CL_ABAP_BEHAVIOR_SAVER` (at
most one). A handler method belongs to a determination, validation or action
whose name it has, ignoring case and underscores (`SetStatus` = `set_status`).
Its parameters are a subset of:

| Parameter | Type | Direction |
| --- | --- | --- |
| `keys` (required) | `TABLE FOR DETERMINATION` / `VALIDATION` / `ACTION IMPORT ...~Action` | IMPORTING |
| `entities` | `TABLE FOR READ RESULT` (the instances) | CHANGING (IMPORTING for a validation) |
| `result` | `TABLE FOR ACTION RESULT ...~Action` | CHANGING |
| `failed`, `reported` | `RESPONSE FOR FAILED|REPORTED EARLY` | CHANGING |

Methods may be private; the call is dynamic. Anything else is refused at
generation with the method's name. The saver's phases take no parameters in
R2 (see ANORMALIES, "RAP saver phases"): a saver can observe but not fail the
save. Messages are made with `new_message_with_text( )` (`ZCL_OSD_RAP_MESSAGE`,
an `if_abap_behv_message`).

Clean-room: the base classes and constants are reimplemented from the public
documentation; `open-abap-rap` (no licence) was read only as a signature spec.

## Serving (R2c)

```
src/rap_demo/zui_rap_note.srvd.srvdsrv     define service ZUI_RAP_NOTE { expose ZI_RAP_NOTE as Note; }
GET    /sap/opu/odata/sap/ZUI_RAP_NOTE/Note                 V2 list, through the CDS view
POST   /sap/opu/odata/sap/ZUI_RAP_NOTE/Note                 {"NoteText":"..."} -> 201, NoteId drawn, Status 'N'
PATCH  /sap/opu/odata/sap/ZUI_RAP_NOTE/Note('<32 hex>')     MERGE and PUT too -> 204
DELETE /sap/opu/odata/sap/ZUI_RAP_NOTE/Note('<32 hex>')     -> 204
POST   /sap/opu/odata/sap/ZUI_RAP_NOTE/Approve?NoteId='<32 hex>'   the action -> 200, the note
GET    /sap/opu/odata4/sap/ZUI_RAP_NOTE/Note                V4 reads of the same instances
POST   /sap/opu/odata4/sap/ZUI_RAP_NOTE/Note                V4 create -> 201, same behavior (PATCH, DELETE too)
npx mocha test/rap-serve.mjs                 # after npm run transpile
```

### Decision: the SRVD itself, read by a generator

The transpiler refuses SRVD objects (ANORMALIES `srvd-not-allowed`), which
is the same position a BDEF is in. So a service definition is treated the
same way: `\.srvd\.` joins the transpile `exclude_filter`, and
`tools/rap/srvd-gen.mjs` (run by `bdef-gen.mjs`) reads it with the BDEF
tokenizer and writes `gen/rap/<srvd>.stg.yaml`, a model `stg-compile --all`
compiles like every other service (`gen/rap` is one of its roots, beside
`gen/cds`). The other option, a YAML `rap:` source written by hand, was not
needed: the object a RAP developer writes is the one read, and the YAML stays
an internal format.

What is read: header annotations (only `@EndUserText.label` is kept, as the
description), `define service <name> { expose <CDS entity> [as <alias>]; ... }`.
Element annotations, `provider contracts`, `with`, extensions and anything
else are refused with the line. There is no service binding (SRVB): the
service is named after the definition, version 0001, and is served on both
endpoints the gateway has, V2 at `/sap/opu/odata/sap/<srvd>/` and V4 at
`/sap/opu/odata4/sap/<srvd>/`.

### The model

Per exposed entity: entity type `<alias>Type`, set `<alias>`, properties
named as the CDS source spells the elements (`NoteId`), bound to the view
through SADL (`source: {cds: ...}`). An entity of a managed BDEF gets the
set flags of its `create` / `update` / `delete`, `readonly` fields as
read-only properties (`readonly : update` as not updatable), and each
instance action a V2 function import named after the action: `POST`, its
parameters the keys, its result the entity, `sap:action-for` the entity type.
An exposed entity without a behavior is a read-only set. Every property is
labelled (the CDS label, else its name), the title a Fiori client shows.
The classes are `ZCL_<service>_MPC/_DPC(_EXT)` for a name of up to 18
characters; a longer one (at most 26) keeps 12 and adds 6 hex characters of
its hash, so two services sharing a prefix get classes of their own. A
namespaced service keeps its namespace in front of the classes
(`/DMO/CL_<name>_MPC`, the shape stg-compile's own `cls` gives a project
that names no classes): the namespace and `CL_` cost 8 of the 30
characters instead of `ZCL_`'s 4, so 14 of the name, or 8 plus the hash.
The file the generator reads is abapGit's `#ns#name.srvd.srvdsrv`; the
stem is decoded before it is compared with the service the text defines.

segw-gen (and its ABAP twin `ZCL_STG_SEGW_GEN`) declared the text element
container `GC_INCL_NAME` only when a property had a label, while a function
import and its parameters always name it: a model with an action and no
labelled property did not compile. Both now declare it for any of the three.

A RAW16 UUID key is served as a 32-character hex `Edm.String`
(`Note('333C0064...')`): the V2 wire has no `Edm.Guid` conversion (hyphenated
JSON, `guid'...'` keys) yet, and V4 follows V2's model.

### The path of a request

Reads are untouched: `ZCL_STG_SADL_DPC` reads the view. Writes and actions
ask first whether the entity has a behavior: `zif_stg_sadl_behavior`
(`src/sadl/`), implemented by `ZCL_OSD_RAP_SADL` (`src/rap/`), which the SADL
provider creates by name so `src/sadl/` does not depend on `src/rap/`. If it
does, the provider hands over the view's row and the names of the fields the
body gave (`zcl_stg_entry_provider->fields( )`), and `ZCL_OSD_RAP_SADL` runs
one RAP transaction:

1. the derived table (`TABLE FOR CREATE/UPDATE/DELETE`, `ACTION IMPORT`) from
   the adapter's `new_table( )`, filled by component name, `%control` set for
   every field the request gave;
2. `modify( )` or `execute( )`; a FAILED row ends here with `rollback( )`;
3. `commit( )`, the save sequence; a validation that fails ends here, and the
   runtime has already rolled the LUW back;
4. the row is read back through the view and answered.

A refusal in 2 or 3 is `/IWBEP/CX_MGW_BUSI_EXCEPTION` with the REPORTED
message texts joined by `; ` (a failure without a message is named by its
cause), which the gateway answers with 400 -- and nothing is written. A
`ZCX_OSD_RAP` (a model error, a refused database write) is a technical
exception, 500.

Two rules a client meets:

- **Read-only fields.** Sent with a value on create, or with a value other
  than the current one on update, the field is flagged and the runtime
  refuses it (`Field STATUS is read-only`, 400). Sent empty on create or
  unchanged on update it is no write and is dropped, so a client that sends
  the whole entity (PUT, or a create carrying the empty managed key) is not
  refused for it.
- **PUT replaces, PATCH and MERGE merge.** On PUT an editable field the body
  does not give is written initial (flagged in `%control`, so the mandatory
  check and the validations see it: a PUT without `NoteText` is 400 and the
  row stays), and a read-only field keeps its value; on PATCH and MERGE only
  the given fields change. `zcl_stg_entry_provider->merges( )` tells the two
  apart, and `zif_stg_sadl_behavior~update` takes `iv_replace`.
- **Keys** come from the URL on update and delete, from the function
  import's parameters for an action, and are drawn by managed numbering on
  create; the created key is taken from MAPPED.

A function import whose return set is not named (SEGW leaves it empty for an
action for an entity type) now gets the first set of its return type in the
request context, with the function's name and parameters
(`zcl_stg_request_context-mv_function_import`, `mt_parameter`): SADL's
`execute_action` is given only the context.

### V4

V4 reads (`$metadata`, the set, by key, `$filter`, `$count`) work as for any
service of the registry ([odata-v4.md](odata-v4.md)), and so do V4 writes
since the V4 write slice (#858): POST, PATCH and DELETE reach the same
provider and so the same behavior (numbering, determination, validation),
which needed no change for it (`test/rap-serve.mjs`, "reads and creates the
same instances over V4"). A BDEF action is a V4 bound action
(`<Action Name="Approve" IsBound="true" EntitySetPath="_it">`):
`POST .../Note('<32 hex>')/ZUI_RAP_NOTE.Approve` with `{}` (or no body) runs
it through the behavior as the V2 function import does -- `ZCL_OSD_V4_ACTION`
hands SADL's `execute_action` the context of a function import
(`mv_function_import`, `mt_parameter`, the set of the action's type), and
`ZCL_OSD_RAP_SADL` runs one RAP transaction with the action's `FOR MODIFY
... FOR ACTION` handler -- and answers 200 with the entity
(`$metadata#Note/$entity`). The V4 rules of a bound action apply
([odata-v4.md](odata-v4.md)): a key nobody has is 404 before the behavior
runs, the key and body parameters go through the MaxLength check (400), the
entity lock is taken (409), and `If-Match` is checked as for a PATCH: 412 on
a mismatch, 428 without it when the entity type has an ETag. `NoteType` has
none (its BDEF declares no `etag master`), so the demo needs no
`If-Match` and a tag it sends is 412; the trip demo of R4 has one. An action the BDEF does not declare is
no operation of the service (404, `Unknown operation`); a refusal of the
behavior (FAILED, a validation) is 400 as over V2 (`test/rap-serve.mjs`).

### Not in R2c

Service bindings, `Edm.Guid` for UUID keys, a
`$batch` changeset as one RAP transaction (each operation is its own save
sequence, committed or rolled back with the changeset),
deep insert through compositions, action parameters, static and factory
actions, messages as `sap-message` headers (only the error body), a Fiori
Elements app over the service.

## R4: the flight constructs that need no composition

R4's goal was the managed business objects of the flight reference
scenario (`packs/rap-flight`) served end to end like the note demo. It is
not reached, and the measurement says why before anything was built:
`node tools/rap-flight/constructs.mjs` lists, per behavior definition of
the scenario, every construct it and its pools use and what this tree does
with it (runs, ignored, refused), and the first refusal of the generators.
Every one of the ten BDEFs of the managed scenario and the reuse layer is
still refused at its first wall after R4 -- projection `use` (5),
compositions / associations (`/DMO/I_TRAVEL_M`, `/DMO/I_SUPPLEMENT`,
`/DMO/R_AGENCYTP` at a determine action), an interface BDEF, unparsed
singleton grammar -- and behind those walls draft (7 of 10).

What R4 makes run are the constructs those BDEFs use that need no
composition, in the order of how many BDEFs each unblocks, on the trip
demo of [`src/rap_r4`](../src/rap_r4/README.md) (`ZI_RAP_TRIP`, service
`ZUI_RAP_TRIP`, `test/rap-r4.mjs`):

| construct | flight BDEFs | before | after |
| --- | ---: | --- | --- |
| `etag master <field>` | 4 | parsed, ignored | the entity type's ETag (`etag: true` on the property, `set_as_etag`): V2 and V4 answer it, a PATCH, PUT, DELETE or V4 bound action without `If-Match` is 428, with a stale one 412 |
| `@Semantics` administrative fields | (all 4 above) | not filled | stamped by the runtime: `createdAt` / `createdBy` on create, `lastChangedAt` / `localInstanceLastChangedAt` / `lastChangedBy` / `localInstanceLastChangedBy` on create and change |
| `FOR INSTANCE FEATURES` with `update / delete / action ( features : instance )` | 2 | the method refused, the options ignored | an update, delete or action asks the method for the instance and is refused when it answers `if_abap_behv=>fc-o-disabled` |
| `early numbering` with `FOR NUMBERING ... FOR CREATE ent` | 2 | refused | the method draws the keys of a create before the instances enter the buffer |
| `association _x { create ( features : instance ); }` | 1 | refused | refused: it controls a create by association, which needs compositions (below) |

**ETag.** `srvd-gen.mjs` marks the `etag master` element `etag: true`, so
the generated MPC calls `set_as_etag` and the gateway's existing ETag path
(V2 dispatcher, V4 facade, the bound-action check of #901) does the rest:
`W/"<value>"`, 428 without `If-Match`, 412 on a mismatch. A RAP action
served as a V2 function import is guarded the same way, alone or as a
changeset member: the SADL provider says the import is an action of a
behavior (`ZIF_STG_ACTION_GUARD`), and the dispatcher checks `If-Match`
against the instance its key parameters name before the action runs. A
function import of any other provider is not checked, as before (a V2
function import is not ETag-checked by the Gateway on a system). A field nobody
writes would make a constant ETag, so the runtime fills the administrative
fields itself, as the managed framework does on a system: the element's
`@Semantics` annotation names the field, the time is `GET TIME STAMP`, and
a new stamp is always later than the field's current value and the last
one given in the process, also where the clock has not moved. The stamp
is set when the instance changes in the buffer (create, update, a change
an action or determination makes), so the ETag a client reads after an
action is not the one it sent. Moving it forward goes by the calendar
(`cl_abap_tstmp=>add` across a second): `20991231235959` is followed by
`21000101000000`, never by a 60th second, and a field of seconds takes the
second its stamp falls in. `etag dependent` is parsed and ignored (an
entity whose ETag is its master's needs compositions first).

**Instance features.** A BDEF that declares `features : instance` on an
operation or action must have a `FOR INSTANCE FEATURES` method (the
generator refuses it otherwise). Before an update, delete or such an action
of one instance, the runtime calls the method with that instance's key and
a request with every flag on, and reads `%update`, `%delete` or
`%action-<a>` of the result row for that key: `fc-o-disabled` refuses the
operation with `%fail-cause = if_abap_behv=>cause-disabled` and a message
(`Update of trip is disabled`, `Delete of trip is disabled`, `Action ACCEPT
of trip is disabled`), which the OData bridge answers 400 like any other
refusal. **The text is this runtime's, not measured on a system**, and so
are the values of `if_abap_behv=>fc` (a pool compares and assigns the names
only). Inside a handler (IN LOCAL MODE) features are not asked, as on a
system. `create ( features : instance )` is refused (there is no instance to
ask; global features are not done), `%field` of the result is not read
(dynamic field control), and the service does not publish operation control
(`Core.OperationAvailable`, `sap:updatable-path`): a client learns of a
disabled operation from the 400.

**Early numbering.** A create of an entity with `early numbering` hands its
rows (a `TABLE FOR CREATE`) to the `FOR NUMBERING` method first, then takes
the key of each row from the `MAPPED` line with its `%cid` (a row without a
`%cid` gets a transient one for the call, chosen so that no row of the
call carries it, and only those rows lose it again: a caller's `%cid`,
whatever it looks like, comes back in MAPPED). A row the method fails is
dropped with the method's FAILED / REPORTED. A row it neither maps nor fails
breaks the method's contract (every input `%cid` in MAPPED or FAILED) and is
failed by the runtime (`Early numbering of trip gave no key and no failure
for an instance`) rather than created with the key it came with. Field control still applies afterwards, so a
`readonly` key is drawn by the method and refused from the client.

### What stays outside, and why each needs a design of its own

- **Compositions** (`association _x { create; }`, `TABLE FOR CREATE
  ent\_x` with `%target`, `READ ... BY \_x`, `FOR NUMBERING ... FOR CREATE
  ent\_x`, `lock / authorization / etag dependent by _parent`): the buffer
  would hold a tree, the child's key extends the parent's, a delete
  cascades, the save writes several tables in parent order, and the OData
  side becomes navigation and deep insert. The first wall of the travel and
  supplement BOs.
- **Several behavior pools per BDEF** (`/DMO/I_TRAVEL_M` has three): the
  adapter reads the header's pool only; follows from compositions.
- **Draft** (7 of the 10 BDEFs): a second buffer with its own tables,
  `%is_draft` in every key, the draft actions, a total ETag.
- **Projection and interface BDEFs** (`use create`, `use action`, 6 of 10).
- **Late numbering** (`/DMO/R_AGENCYTP`): `%pid` as the identity until
  `adjust_numbers` in the save gives the final key, which then has to reach
  MAPPED, the OData answer and every `%cid_ref`.
- **`with additional save` / `with unmanaged save`** (`save_modified`), the
  **internal** and **factory** actions, **determine actions**, and
  **global authorization**; each is refused by the generator with its name.

## R5: compositions, associations and projections

R4 left every flight BDEF at its first wall, and the walls that stop most
of them are the business object as a **tree** (compositions, `association
_x { create; }`, read by association, `lock dependent`) and the
**projection** BDEF (`projection;` with `use`). R5 is the smallest model
of both that is sound on its own terms; draft stays out (its own track),
and so do several pools, `with additional/unmanaged save`, internal,
factory and determine actions and late numbering, each still refused by
name. Proven on the order demo of [`src/rap_r5`](../src/rap_r5/README.md)
(`ZI_RAP_ORDER` with its items, projected by `ZC_RAP_ORDER`, served as
`ZUI_RAP_ORDER`, `test/rap-r5.mjs`, `ZCL_OSD_RAP_R5_TEST`). Nothing here is
measured on a system; the semantics follow the public RAP documentation and
each deviation is written down below.

### The tree comes from CDS, the behavior from the BDEF

A composition is declared where a system declares it: the root view says
`composition [0..*] of ZI_CHILD as _Child`, the child view `association to
parent ZI_ROOT as _Root on $projection.k = _Root.k`. `tools/cds2ddic.mjs`
reads both (`CDSComposition`, `association to parent`): the composition is
an association of kind `CHILD` whose key pairs are the reverse of the
child's to-parent `ON` condition (a composition has no `ON` of its own),
and the to-parent association one of kind `PARENT`. The parent of an entity
is the target of its `PARENT` association, its children the targets of its
`CHILD` ones; a BDEF entity's `lock dependent by _x`, `etag dependent by
_x` and `authorization dependent by _x` must name that association (the
generator refuses another). One root per BDEF, any depth.

**The key of a child extends its parent's.** The pairs of the to-parent
association say which child fields carry the parent key; the runtime fills
them from the parent on a create by association, and a client cannot
(a create by association that names another parent's key in them is
overwritten, not refused: the parent in the URL or the `%tky` decides).

### The model the runtime gets

`ZIF_OSD_RAP_BO=>TY_ENTITY` gains:

| component | what |
| --- | --- |
| `parent`, `parent_assoc` | the parent entity (CDS name) and the to-parent association, initial for the root |
| `root` | the root entity of the tree |
| `lock` | `M` for `lock master`, `D` for `lock dependent` |
| `assocs` | every association the BDEF declares for the entity: `name`, `target`, `kind` (`C` composition child, `P` to parent, `A` other), `create` (`association _x { create; }`), `feat_create` (`create ( features : instance )`), `numbering` (`E` when the target is drawn by a `FOR NUMBERING ... FOR CREATE e\_x` method), `pairs` (source field to target field) |

### Derived types

Per association `_x` of entity `e` with target `t`, `bdef-gen.mjs` writes
the types a pool and EML use (`TYPE TABLE FOR ... e\_x`):

- `CREATE e\_x`: the source's `%tky`, `%cid_ref`, and `%target`, a table
  of `t`'s create rows (`%cid`, `t`'s fields, `%control`);
- `READ IMPORT e\_x`: the source's `%tky` and `t`'s `%control`;
  `READ RESULT e\_x`: `t`'s read result rows; `READ LINK e\_x`:
  `source` (the source's `%tky`) and `target` (`t`'s `%tky`);
- the features result of `e` gets `%assoc-_x` for a `create ( features :
  instance )`;
- `FOR NUMBERING IMPORTING entities FOR CREATE e\_x` gets `TABLE FOR
  CREATE e\_x` and the BDEF's `RESPONSE FOR MAPPED EARLY`, as on a system.

### Runtime

- **Create by association** (`create_by( iv_entity iv_assoc it_rows )`,
  `TABLE FOR CREATE e\_x`): each row's parent is resolved by `%tky` or
  `%cid_ref` (an instance created earlier in the same transaction, also in
  the same request), else the row fails on the source entity
  (`not_found`). `create ( features : instance )` asks the source's
  features (`%assoc-_x`). The parent is locked (below). Each `%target` row
  becomes a create of `t`: the parent's key is put into the pair fields
  (not flagged in `%control`, so a read-only key is no refusal), early
  numbering of `t` calls the pool's `FOR NUMBERING ... FOR CREATE e\_x`
  method with the rows, and from there it is the create of R2/R4 (field
  control, `%cid`, MAPPED of `t`, determinations and validations of `t`).
  A create of an entity that has a parent is refused unless it goes through
  the association (a child is never created on its own).
- **Read by association** (`read_by( iv_entity iv_assoc it_keys ct_result
  ct_link )`): for each source instance the target instances whose pair
  fields equal the source's, from the buffer and from the persistent table
  (a buffered instance hides its saved row, a deleted one is not read), in
  key order; to the parent it is one instance. `ct_link` gets the source
  and target keys.
- **Delete cascades.** Deleting an instance deletes its composition
  children, recursively, without asking their features (it is the
  framework's delete, not the client's); the save writes the children's
  deletes too.
- **Lock.** `lock master` / `lock dependent by _parent`: before an update,
  delete, action or create by association of an instance, the runtime
  takes an exclusive lock on its **root** instance (lock object
  `EZOSD_RAP_LOCK`, argument the SHA-256 of BDEF, root entity and root
  key, `_SCOPE 2`), released by the runtime itself (`DEQUEUE`) when the
  transaction ends: after the save's `COMMIT WORK`, after a failed save's
  `ROLLBACK WORK`, and on `rollback( )`. That is needed and not a
  nicety: a `COMMIT WORK` that queued no update releases no lock
  (`tools/osd-enq.mjs`, the measured owner model). Inside a batch that
  holds the LUW the locks stay until the request ends. One lock per root
  per transaction. Held by another owner, the operation fails with
  `%fail-cause = if_abap_behv=>cause-locked` and the message `<Root alias>
  <key> is locked by another user` (this runtime's text), which the OData
  bridge answers with **409**. A new root is not locked (nobody else can
  see it); `lock master` on a child or `lock dependent` without a parent is
  refused by the generator. The pool's `FOR LOCK` method (unmanaged lock)
  is not called: managed only.
- **ETag of the root.** A field annotated
  `@Semantics.systemDateTime.lastChangedAt` (or `@Semantics.user.lastChangedBy`)
  on the root is the BO's total change stamp, as on a system: a create,
  update or delete of any instance of the tree stamps the root instance's
  fields too (the `localInstanceLastChanged*` fields stay per instance).
  So the root's `etag master` moves with every child write and a client
  holding the old ETag of the root gets 412. Each entity's own `etag
  master` works as in R4; `etag dependent by _parent` (the child's ETag is
  its master's) is accepted and not served (the child type gets no ETag).
- **Save order.** The delta keeps the order of the changes, and a parent
  is always created before its children; deletes of the children come
  first in the delta of a cascade.

### EML

`ZCL_OSD_RAP_EML=>CREATE_BY` and `=>READ_BY` (and `KERNEL_RAP_EML`'s
`create_by` / `read_by`, with the parameter shape of the other kernel
calls plus `assoc`) are what `MODIFY ENTITIES ... CREATE BY \_x` and `READ
ENTITIES ... BY \_x [LINK]` lower to. The pinned transpiler does not
lower `BY` yet (`ModifyEntities BY, not supported, transpiler`), so the
demo pool writes the call with the statement in a comment above it, as R3
did before the EML pin; the lowering is a transpiler follow-up.

### Projections

A projection BDEF (`projection; define behavior for ZC_X alias X { use
create; use update; use delete; use action a; use association _y { create;
} }`) over projection views (`define root view entity ZC_X provider
contract transactional_query as projection on ZI_X { key a as A, ...,
_Y : redirected to composition child ZC_Y }`) is a **thin layer**: no
buffer, no pool, no runtime of its own.

- `tools/cds2ddic.mjs` reads `as projection on` (one base view, elements
  with `as` renames, `redirected to [composition child|parent]`): a
  redirected association is the base view's association with the target
  replaced and its pairs renamed through both projections.
- `bdef-gen.mjs` resolves a projection BDEF against its base BDEF (the BDEF
  of the base view of its root): every projection entity names a base
  entity, every `use` names something the base declares (else refused),
  and the derived types are written for the projection entities as for
  any (field names as the projection spells them).
- The registry (`ZIF_OSD_RAP_REGISTRY=>PROJECTION`) answers per projection
  entity the base BDEF, base entity, the field map (projection element to
  base element), the `use`d operations, actions and associations, and the
  projection's own `field ( readonly )`.
- `ZCL_OSD_RAP_SADL` maps a projection row to a base row by that map, runs
  the base runtime, and maps the keys back; an operation the projection
  does not `use` is refused (400) before the base sees it.
- EML on a projection (`MODIFY ENTITIES OF zc_x`) is not routed yet; a
  projection's own behavior pool (`augment`, `precheck`) is refused.

### OData

`srvd-gen.mjs` writes for every exposed entity its associations to other
exposed entities: an association `to_<alias without _>` with the pairs as
the referential constraint and the navigation on the source (both
directions of a composition are navigable). Reads through a navigation and
`$expand` then take the existing SADL path (the CDS registry's pairs).
`POST Root(...)/to_Child` (V2) and `POST Root(...)/to_Child` (V4, where
writes through a navigation property were 501) create by association:
the SADL provider sees the navigation path and hands the parent key and
the association to `zif_stg_sadl_behavior~create_by`. A child set has
`creatable` only through its parent: a POST on the child's own set is 400
("created through its parent"). The navigation name is the V2 one
(`to_Items`) on both protocols, as for every service of this registry; a
RAP V4 binding on a system names it `_Items`.

### What R5 leaves

Draft (and `association _x { with draft; }`, refused), several pools
(`/DMO/I_TRAVEL_M`), `with additional/unmanaged save`, internal, factory
and determine actions, late numbering, deep insert as one create by
association (a POST with the children inline on the parent), `etag
dependent` served, EML on a projection, a projection's own pool, `FOR
LOCK` of an unmanaged lock, global features and authorization.

## Not in R2

EML; draft; unmanaged save, `with additional save`,
`with unmanaged save`; early/late numbering through the pool and
`adjust_numbers`; associations and compositions (R1 refuses them); static,
factory and internal actions, action parameters and results other than
`$self`; functions; delete triggers; feature and authorization control; locks
and ETags; projections. Each is refused by the generator or ignored as listed
above. R4 (above) adds the ETag, instance features and early numbering.
