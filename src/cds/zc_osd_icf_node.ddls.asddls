@AbapCatalog.sqlViewName: 'ZVOSDICFN'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ICF registry: the nodes this system answers on'
// The service tree as a system keeps it, with the three things hanging off
// a node that SICF shows on tabs: its handler chain, its descriptions and
// -- ours, not SAP's -- who last wrote the row.
//
// The associations carry their referential constraint, unlike the status
// service's: a handler belongs to ONE node, so the expand must be filtered
// by the node's key rather than read whole.
define view ZC_OSD_ICF_NODE
  as select from icfservice
  association [0..*] to ZC_OSD_ICF_HANDLER as _Handlers on  _Handlers.IcfName    = $projection.IcfName
                                                        and _Handlers.IcfParGuid = $projection.IcfParGuid
  association [0..*] to ZC_OSD_ICF_DOCU    as _Docu     on  _Docu.IcfName        = $projection.IcfName
                                                        and _Docu.IcfParGuid     = $projection.IcfParGuid
  association [0..1] to ZC_OSD_ICF_ORIGIN  as _Origin   on  _Origin.IcfName      = $projection.IcfName
                                                        and _Origin.IcfParGuid   = $projection.IcfParGuid
{
      @EndUserText.label: 'Node'
  key icf_name   as IcfName,
      @EndUserText.label: 'Parent'
  key icfparguid as IcfParGuid,
      @EndUserText.label: 'URL'
      url        as Url,
      @EndUserText.label: 'Active'
      icfactive  as IcfActive,
      @EndUserText.label: 'Original name'
      orig_name  as OrigName,
      @EndUserText.label: 'Alias'
      icfaltnme  as IcfAltNme,
      _Handlers,
      _Docu,
      _Origin
}
