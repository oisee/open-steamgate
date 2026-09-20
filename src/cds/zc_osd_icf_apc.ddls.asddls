@AbapCatalog.sqlViewName: 'ZVOSDICFA'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ICF registry: WebSocket APC applications of a node'
// APC's implementation class is not an HTTP handler-chain entry.
define view ZC_OSD_ICF_APC
  as select from zosd_icf_apc
{
      @EndUserText.label: 'Node'
  key icf_name       as IcfName,
      @EndUserText.label: 'Parent'
  key icfparguid     as IcfParGuid,
      @EndUserText.label: 'Application ID'
  key application_id as ApplicationId,
      @EndUserText.label: 'Implementation class'
      handler        as Handler,
      @EndUserText.label: 'Stateful'
      stateful       as Stateful
}
