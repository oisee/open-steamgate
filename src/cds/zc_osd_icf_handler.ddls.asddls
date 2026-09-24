@AbapCatalog.sqlViewName: 'ZVOSDICFH'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ICF registry: the handler chain of a node'
// One row per handler, in the order ICF runs them. A node's chain is the
// thing SICF's "Handler List" tab shows, and it is a list rather than a
// field because a node may carry several and the order decides.
define view ZC_OSD_ICF_HANDLER
  as select from icfhandler
{
      @EndUserText.label: 'Node'
  key icf_name   as IcfName,
      @EndUserText.label: 'Parent'
  key icfparguid as IcfParGuid,
      @EndUserText.label: 'Order'
  key icforder   as IcfOrder,
      @EndUserText.label: 'Type'
      icftyp     as IcfTyp,
      @EndUserText.label: 'Handler'
      icfhandler as IcfHandler
}
