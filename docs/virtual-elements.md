# Virtual elements: a CDS field an ABAP class calculates

A CDS element with no column behind it. The view declares its type and who
fills it; after the SELECT the SADL runtime calls that class with the rows it
read, and the class writes the value in. This is where CDS and ABAP meet, and
it is the one place in a SADL service where a developer's own code runs on a
read.

```
@EndUserText.label: 'Occupancy'
@ObjectModel.virtualElement: true
@ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_STG_TRAVEL_CALC'
cast( '' as abap.char( 12 ) ) as Occupancy,
```

`src/cds/zc_stg_travel.ddls.asddls` has two of them: `Occupancy` (from the
row itself) and `FreeSeats` (seats minus the bookings of that travel, so the
class reads another table).

## What carries it

- **The view** (`tools/cds2ddic.mjs`): an element whose source is a `cast( )`
  and whose annotations say `virtualElement` becomes a field with the ABAP
  type read out of the cast (`char`, `numc`, `int1/2/4/8`, `dec`, `curr`,
  `quan`, `dats`, `tims`, `string`) and the class name from
  `virtualElementCalculatedBy: 'ABAP:…'`. It is **left out of the SQL view**
  (no `DD27P` row), the way SAP leaves it out.
- **The row** the runtime works with is the source class's `ty_row`: the
  columns of the SQL view (`INCLUDE TYPE`) plus the virtual elements, with
  `tt_row` next to it. A DPC over a CDS entity declares its table as
  `zcl_stg_cds_<view>=>tt_row`, so the calculated values survive the way back.
- **The exit** (`src/sadl/if_sadl_exit_calc_element_read.intf.abap`, with
  `if_sadl_exit` and `cx_sadl_contract_violation`): the interface an exit
  class is written against, reimplemented clean-room so that a class written
  for a system compiles here unchanged. `zcl_stg_travel_calc` is such a class
  and contains nothing specific to this project.
- **The runtime** (`zcl_stg_sadl_dpc`): `calculate_virtual` groups the
  virtual elements of an entity by their class, creates each one by name and
  calls `calculate` with the rows, on the entity set and on a single entity.
- **The model** (`cl_sadl_gw_model_exposure`): the property is exposed like
  any other, but `sap:sortable="false" sap:filterable="false"`, because the
  database cannot order or filter by a value it does not have.
- **The refusal** (`reject_virtual`): a `$filter` or `$orderby` that names a
  virtual element is answered 400 with a message saying why, instead of
  failing in SQL.

## Tested

- `ltcl_sadl->registry_from_cds` (the registry carries `virtual` and
  `calculated_by`), `ltcl_sadl->expand` (the values travel through `$expand`).
- `test/mocha.mjs`, "virtual elements": the metadata flags, the values over
  the wire for the set and for one entity, and the two refusals.

## Not yet

`get_calculation_info` is declared and implemented in the demo class but the
runtime does not call it yet: every read hands the exit the whole row, so
nothing is missing, but a `$select` that drops a column the class needs would
not be repaired. Also not yet: a virtual element on a cube (the calculation
runs after `GROUP BY`, which is a different contract), and virtual elements
on a `table:` source.
