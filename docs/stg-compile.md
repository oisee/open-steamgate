# stg-compile: the SEGW project as one file

SEGW is two things: an editor for a project tree and a generator. We have
the generator (`tools/segw-gen.mjs`: tree → `_MPC`/`_DPC`). `tools/stg-compile.mjs`
is the editor without the GUI: a `<service>.stg.yaml` describes the
service, the compiler writes the tree exactly as abapGit serializes it
(`<project>.iwpr.xml`), the two registration objects (`<service> 0001.iwsv.xml`,
`<model> 0001.iwmo.xml`) and, through segw-gen, the four classes. Deploy the
folder with abapGit and SEGW on the system opens a normal project; here,
`tools/segw-registry.mjs` registers the service from the same objects.

```sh
npm run stg:compile -- src/demo/zstg_demo.stg.yaml            # the tree to stdout
npm run stg:compile -- src/demo/zstg_demo.stg.yaml --out gen/demo
npm run segw:gen -- gen/demo --check                           # identical, of course
npm run segw -- gen/demo --list                                # what the registry would register
```

The `_EXT` pair is written only when missing: it is the developer's code.
A second compile after editing the YAML rewrites the tree and the base
classes and leaves `_EXT` alone, which is what SEGW's "Generate" does.

Node identifiers in the tree are a hash of project, kind and name, so the
same file gives the same bytes; a diff of two compiles is a diff of the
model.

## The file

```yaml
project: ZSTG_DEMO              # SEGW project; classes ZCL_<project>_MPC/_DPC(+_EXT)
service: ZSTG_DEMO_SRV          # technical = external name, version 0001
model: ZSTG_DEMO_MDL            # default <project>_MDL
description: "…"
classes: {mpc: …, dpc: …}       # optional overrides (mpc, mpc_ext, dpc, dpc_ext)

entities:
  Travel:
    set: TravelSet              # default <name>Set
    source: {struct: ZSTG_DEMO} # the ABAP structure behind the type (bind_structure)
            {table: ZSTG_DEMO_BK}   # a DDIC table served by SADL: the DPC delegates
            {cds: ZSTG_I_STATUS}    # a CDS view served by SADL
            # none: the base class declares TS_<entity> from the properties
    keys: [TravelId]
    properties:
      TravelId: String(8)       # shorthand: <Edm type>(<length>) or Decimal(<digits>,<scale>)
      Seats: {type: Int32, field: SEATS, label: Seats, nullable: true}
      StatusText: {type: String(40), readonly: true, sortable: false, filterable: false}
    creatable: true             # set flags: creatable updatable deletable pageable
    searchable: true            # addressable searchable subscribable filterRequired
    operations: [C, R, U, D, Q] # the DPC methods SEGW writes; default all five

associations:
  TravelToBookings:
    from: Travel
    to: Booking
    cardinality: 1:N            # 1:1, 1:N, N:1, N:N (0..1 as 0)
    constraint: {TravelId: TravelId}          # principal (from) -> dependent (to)
    navigation: {Travel: to_Bookings, Booking: to_Travel}
    set: TravelToBookingsSet    # default <name>Set

functions:
  CancelTravel:
    method: POST
    returns: {entity: Travel, set: TravelSet, multiplicity: "1"}
    for: Travel
    parameters:
      TravelId: {type: String(8), field: TRAVEL_ID}
```

Property defaults: `field` = the name in upper case; creatable, updatable,
sortable, filterable = true; nullable = true; a key is not nullable and not
updatable; `readonly: true` turns creatable and updatable off. Labels
become `PROP_LABEL` in the tree (SEGW's text elements are not generated;
the label lives in the tree for the next step).

## What it is checked against

`test/stg-compile.mjs`: the demo's YAML (`src/demo/zstg_demo.stg.yaml`)
reads back through segw-gen as the same model, the generated MPC defines
what the hand-written `zcl_zstg_demo_mpc` defines, the IWSV/IWMO come out
byte-identical to the demo's, `table:`/`cds:` become SADL delegation, and
the compiled classes lint clean against the libraries. The hand-written
demo classes stay as they are: they are the showcase of real DPC code; the
YAML is the same model in the form a system-less workflow edits.

## Not yet

Complex types, `function:` (RFC-mapped entities: the mapping rows exist in
segw-gen, the YAML side does not), `service:` (Include / ODC), annotations
in the file (`set_value_list`, vocabulary annotations), text elements. The
step after this: `gen/` output wired into `npm run transpile` so a YAML in
`src/` registers itself like the hand-written services do.
