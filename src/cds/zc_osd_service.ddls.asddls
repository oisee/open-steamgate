@AbapCatalog.sqlViewName: 'ZVOSDSVC'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD system status: the services'
define view ZC_OSD_SERVICE
  as select from zosd_svc
{
      @EndUserText.label: 'Path'
  key path    as Path,
      @EndUserText.label: 'Kind'
      kind    as Kind,
      @EndUserText.label: 'Handler'
      handler as Handler,
      @EndUserText.label: 'Pack'
      pack    as Pack
}
