@AbapCatalog.sqlViewName: 'ZVOSDPORT'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD system status: the ports'
define view ZC_OSD_PORT
  as select from zosd_port
{
      @EndUserText.label: 'Port'
  key port     as Port,
      @EndUserText.label: 'Protocol'
      protocol as Protocol,
      @EndUserText.label: 'Purpose'
      purpose  as Purpose,
      @EndUserText.label: 'State'
      state    as State,
      @EndUserText.label: 'Note'
      note     as Note
}
