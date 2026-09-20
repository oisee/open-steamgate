@AbapCatalog.sqlViewName: 'ZVOSDDB'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD system status: database facts'
define view ZC_OSD_DATABASE
  as select from zosd_db
{
      @EndUserText.label: 'Section'
  key section as Section,
      @EndUserText.label: 'Fact'
  key name    as Name,
      @EndUserText.label: 'Value'
      value   as Value,
      @EndUserText.label: 'Note'
      note    as Note
}
