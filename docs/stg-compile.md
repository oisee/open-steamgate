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
            {service: ZSTG_SADL_SRV, set: Zc_Stg_TravelSet}   # another service of this
            #   registry, consumed in-process (SEGW's "external service", local flavour)
            # none: the base class declares TS_<entity> from the properties
    keys: [TravelId]
    properties:
      TravelId: String(8)       # shorthand: <Edm type>(<length>) or Decimal(<digits>,<scale>)
      Seats: {type: Int32, field: SEATS, label: Seats, nullable: true}
      StatusText: {type: String(40), readonly: true, sortable: false, filterable: false}
    creatable: true             # set flags: creatable updatable deletable pageable
    searchable: true            # addressable searchable subscribable filterRequired
    operations: [C, R, U, D, Q] # the DPC methods SEGW writes; default all five
    operations:                 # ...or, per operation, SEGW's "Map to Data Source"
      query:
        function: SEPM_GWS_PRODUCTS_GET      # an RFC/BOR module
        group: SEPM_GATEWAY_SERVICES         # its function group (optional)
        destination: NONE                    # RFC destination (optional)
        log: ET_RETURN                       # the BAPIRET2 table (optional)
        ranges: {ProductId: IT_PRODUCT_ID_RANGE}   # $filter -> range table (HIGH/LOW/OPTION/SIGN)
        constants: {"IT_CONTROL\VALUE": "'X'"}     # parameter path -> literal
        out: {ProductId: "ET_LIST\PRODUCT_ID"}     # response side: property <- parameter path
      read:
        function: SEPM_GWS_PRODUCT_GET_DETAIL
        in: {ProductId: IV_PRODUCT_ID}             # request side: property -> parameter path
        out: {ProductId: "ES_PRODUCT\PRODUCT_ID"}
      # or a search help instead of a module:
      #   query: {searchhelp: ZSTG_STATUS_SH, in: {Status: STATUS}, out: {Status: "RESULT_LIST\STATUS"}}

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

## Operations mapped to a module or a search help

A map under `operations` is SEGW's "Map to Data Source" per operation
(`docs/segw-mapping.md` has what the tree stores and what the DPC gets):
`function:` writes a data source of type 2, `searchhelp:` one of type 6,
`in`/`out`/`ranges`/`constants` become the `SBD_MP`/`SBD_MR` rows, and
segw-gen writes the RFC or search-help method for it. The module's
signature has to be at hand: an abapGit `*.fugr.xml` next to the YAML or
in a `--lib` folder; without it the method is a stub and the compiler
warns. `test/fixtures/segw/zstg_mapped.stg.yaml` is the YAML twin of the
hand-made `zstg_mapped.iwpr.xml`; the test expects the same DPC methods
from both.

## A service consumed from another one (`service:`)

`source: {service: X, set: S}` is SEGW's "external service" (ODC) in a local
flavour: the entity's read operations are served by another service of the
same registry. The tree carries it as a data source `ODC~X~S` (a steamgate
extension of the DS_TYPE 4 kinds, not something SEGW writes); the generated
DPC delegates `GET_ENTITYSET` and `GET_ENTITY` to
`zcl_stg_odata_client` (`src/gateway`), which turns the request back into an
OData GET (`$filter`, `$top`, `$skip`, `$orderby`, `$inlinecount`, `search`
unchanged), dispatches it in-process to X and reads the answer into the
local structure by property name. So the consuming service declares the
properties it wants, with the provider's names and its own fields and
types; `$metadata` shows only those. Writes stay stubs. `src/demo_odc/`
is such a service made of one file: `ZSTG_ODC_SRV` over the CDS service,
tested in `ltcl_odc`. An online provider (real HTTP) is the same seam with
`cl_http_client` behind it: not done.

## In the build

`stg-compile --all` runs in `npm run transpile`: every `src/**/*.stg.yaml`
compiles into `gen/stg/<project>/` (classes, IWSV, IWMO) except the objects
that already exist under `src/` by name, so the demo's hand-written classes
win over their YAML and `src/demo_odc/` gets everything generated. The
registry reads `gen/` too, so a YAML-only service registers itself.

## Not yet

Complex types, Include (merging another service's model), annotations in
the file (`set_value_list`, vocabulary annotations), text elements,
function imports mapped to a module.
