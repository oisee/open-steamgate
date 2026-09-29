@AbapCatalog.sqlViewName: 'ZGOGEN_T_DBWV'
@EndUserText.label: 'gogen CDS name probe'
define view ZGOGEN_T_DBWC as select from zgogen_t_dbw {
  key id,
  val as amount
}
