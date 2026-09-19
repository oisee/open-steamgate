@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'OSD ports, as a view entity'
// **The one view entity in this tree, and it is here on purpose.**
//
// Every other view is DDIC-based -- `define view` plus
// `@AbapCatalog.sqlViewName` -- and the modern shape is `define view entity`,
// which has no SQL view behind it at all. `parseDDLS` was written to fall
// back to the view's own name when there is no sqlViewName, and backlog B.15
// asked whether that had ever been run rather than reasoned about. It had
// not.
//
// It is now, by every build: this view is generated, registered, listed and
// read like any other, and `test/cds-cast.mjs` pins the parsing half. The
// duplication with ZC_OSD_PORT is the price of exercising the shape, and a
// small one -- an unexercised code path is the more expensive of the two.
define view entity ZC_OSD_PORT_VE
  as select from zosd_port
{
  key port     as Port,
      protocol as Protocol,
      purpose  as Purpose
}
