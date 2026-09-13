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
POST   /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/Zc_Stg_TravelSet            -> 201, the row is in ZSTG_DEMO
PUT    /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/Zc_Stg_TravelSet('T0700')   -> 204
DELETE /sap/opu/odata/sap/ZC_STG_TRAVEL_CDS/Zc_Stg_TravelSet('T0700')   -> 204
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
- **The DPC** needs nothing new: `zcl_stg_sadl_dpc`'s create, update and
  delete were already generic over `zif_stg_cds_source`.
- **The model.** A published view (`docs/cds-publish.md`) takes its
  `creatable` / `updatable` / `deletable` from the same annotations, the key
  property is not updatable, and segw-gen writes the SADL definition with
  `maxEditMode="EX"` instead of `"RO"` for a writable set (both values are in
  the corpus).
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
