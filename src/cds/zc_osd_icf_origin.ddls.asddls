@AbapCatalog.sqlViewName: 'ZVOSDICFO'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ICF registry: who last wrote a row'
// Not a SAP table and not pretending to be one: the bookkeeping the drift
// rule needs (docs/registry-drift.md). Without it every disagreement
// between the table and the objects is a guess, and an edit made from a
// screen is undone by the next build.
define view ZC_OSD_ICF_ORIGIN
  as select from zosd_icf_origin
{
      @EndUserText.label: 'Node'
  key icf_name   as IcfName,
      @EndUserText.label: 'Parent'
  key icfparguid as IcfParGuid,
      @EndUserText.label: 'Written by'
      origin     as Origin,
      @EndUserText.label: 'Object as applied'
      objhash    as ObjHash,
      @EndUserText.label: 'Changed'
      changed_at as ChangedAt
}
