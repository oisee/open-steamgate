@AbapCatalog.sqlViewName: 'ZVOSDPROC'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD system status: the work processes'
define view ZC_OSD_PROCESS
  as select from zosd_proc
{
      @EndUserText.label: 'Process'
  key pid        as Pid,
      @EndUserText.label: 'Role'
      role       as Role,
      @EndUserText.label: 'Port'
      port       as Port,
      @EndUserText.label: 'Generation'
      generation as Generation,
      @EndUserText.label: 'Epoch'
      epoch      as Epoch,
      @EndUserText.label: 'Since'
      since      as Since,
      @EndUserText.label: 'Sockets'
      sockets    as Sockets,
      @EndUserText.label: 'RSS (MB)'
      rss_mb     as RssMb,
      @EndUserText.label: 'Alive'
      alive      as Alive
}
