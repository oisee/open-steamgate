# Writing through a CDS projection

A CDS view that projects one table field for field can be written through:
the payload becomes a row of the base table, and create, update and delete
land there. A view that joins, aggregates or hides a key column cannot, and
says so instead of guessing.

```
@AbapCatalog.sqlViewName: 'ZVSTGTRAVEL'
@OData.publish: true
@ObjectModel.writeEnabled: true
define view ZC_STG_TRAVEL as select from zstg_demo { ... }
```

```
POST   /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL            -> 201, the row is in ZSTG_DEMO
PUT    /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL('T0700')   -> 204
DELETE /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/ZC_STG_TRAVEL('T0700')   -> 204
```

## When a view is writable

`tools/cds2ddic.mjs` decides, and all four have to hold:

1. the view asks for it (`@ObjectModel.writeEnabled`, or the finer
   `createEnabled` / `updateEnabled` / `deleteEnabled`),
2. it reads from one **table**, not from another view,
3. every key column of that table except the client is a field of the view,
4. it is not analytical (`@Analytics.dataCategory` stays read-only).

What fails a check is not silently read-only: the generated source class
keeps the not-implemented answer and names the reason, for example
`INSERT through ZC_STG_BOOKING: the view does not ask for it`.

## What carries it

- **The source class** gains `to_base`, which maps the row of the view back
  to the row of the table (view field name → base column, the client from
  `sy-mandt`), and `INSERT` / `UPDATE` / `DELETE FROM` over that table. Only
  the operations the view asked for are generated.
- **The registry** carries what the view allows, so a writable exposure can
  still be finer than "everything": a view that asks only for
  `updateEnabled` gets an updatable set that is not creatable.
- **The DPC** needs nothing new: `zcl_stg_sadl_dpc`'s create, update and
  delete were already generic over `zif_stg_cds_source`.
- **The model.** A published view (`docs/cds-publish.md`) takes its
  `creatable` / `updatable` / `deletable` from the same annotations, the key
  property is not updatable, and segw-gen writes the SADL definition with
  `maxEditMode="EX"` instead of `"RO"` when the tree marks the set writable.
  The oracle for that rule is `S_EPM_CDS_EXP`: CDS data sources, its tree
  marks `EmployeeSet` and `LeaveRequestSet` creatable, and its DPC writes
  `EX` for exactly those two; every read-only project in the corpus writes
  `RO`. The definition of the service is the contract the exposure follows,
  so a service whose definition says `RO` stays read-only even over a view
  the annotations would allow writing to.
- **The refusal.** `zcl_stg_dispatcher` now reads the set's flags out of the
  model and answers 405 with the reason before looking for a DPC method, so
  a write to a read-only set no longer arrives as "the data provider created
  nothing".

## Tested

`test/mocha.mjs`, "writes through a CDS projection": POST then the row read
back through the plain table service, PUT, the virtual element recalculated
on the way out, DELETE, then 404; and the two refusals, on an analytical
view and on a read-only SADL service.

## Not yet

Writes through a view with associations (a deep insert into a composition),
ETags on a projection, and the `@ObjectModel.readOnly` element-level
annotation. A projection over another view stays read-only even when the
chain would be resolvable.

## A composition: the child goes with the parent

RAP's vocabulary, entered through the CDS annotation — which is the order
decided in backlog B.2, because abaplint parses `@ObjectModel` in full and a
behaviour definition with a single regular expression.

```
define view ZC_STG_TRAVEL as select from zstg_demo
  association [0..*] to ZC_STG_BOOKING as _Bookings on $projection.TravelId = _Bookings.TravelId
{
  ...
  @ObjectModel.association.type: [#TO_COMPOSITION_CHILD]
  _Bookings
}
```

A booking is then **part of** a travel rather than something the travel points
at, and one thing follows from that today: deleting the parent deletes its
children. `tools/cds2ddic.mjs` emits the child's `DELETE` into the parent's
`delete` method, over the child's own base table, joined on the pairs the
association's `ON` condition gives:

```abap
METHOD zif_stg_cds_source~delete.
  DATA ls_row TYPE zstg_demo.
  ls_row = to_base( is_line ).
* composition: ZC_STG_BOOKING is a part of ZC_STG_TRAVEL, so it goes too
  DELETE FROM zstg_demo_bk WHERE travel_id = ls_row-travel_id.
  DELETE FROM zstg_demo    WHERE travel_id = ls_row-travel_id.
  rv_subrc = sy-subrc.
ENDMETHOD.
```

Both statements are in the one LUW the request already runs in, and
`sy-subrc` still answers for the parent, so a delete that finds no parent
still reports what it found.

`#TO_COMPOSITION_PARENT` on the other end is the child's way of naming its
parent, and it deliberately does **not** cascade: deleting a booking leaves
its travel alone. Only `#TO_COMPOSITION_CHILD` carries the cascade, which is
the same asymmetry a RAP behaviour definition has between `composition of`
and `association to parent`.

The child needs its own `@ObjectModel.writeEnabled` to be written directly;
the cascade works regardless, because it is the parent's statement.

What this is not yet: a transactional buffer, a draft, or a deep insert that
creates header and items in one request. Those are the rest of B.2.
