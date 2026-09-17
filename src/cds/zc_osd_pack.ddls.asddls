@AbapCatalog.sqlViewName: 'ZVOSDPACK'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD system status: the content packs'
define view ZC_OSD_PACK
  as select from zosd_pack
{
      @EndUserText.label: 'Pack'
  key name        as Name,
      @EndUserText.label: 'Order'
      pack_order  as PackOrder,
      @EndUserText.label: 'Objects'
      objects     as Objects,
      @EndUserText.label: 'Folders'
      folders     as Folders,
      @EndUserText.label: 'Description'
      description as Description
}
