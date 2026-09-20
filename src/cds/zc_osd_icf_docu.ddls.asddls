@AbapCatalog.sqlViewName: 'ZVOSDICFD'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ICF registry: a node description, per language'
// Its own entity because that is where a real system keeps it: every
// *.sicf.xml in the corpus carries the description in an <ICFDOCU> block
// and not inside <ICFSERVICE>, keyed by language.
define view ZC_OSD_ICF_DOCU
  as select from icfdocu
{
      @EndUserText.label: 'Node'
  key icf_name   as IcfName,
      @EndUserText.label: 'Parent'
  key icfparguid as IcfParGuid,
      @EndUserText.label: 'Language'
  key icf_langu  as IcfLangu,
      @EndUserText.label: 'Description'
      icf_docu   as IcfDocu
}
