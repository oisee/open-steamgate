@AbapCatalog.sqlViewName: 'ZVTESTITEM'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'ZTEST: demo items (CDS projection)'
define view ZTEST_I_ITEM
  as select from ztest_item
{
  key item_id    as ItemId,
      name       as Name,
      status     as Status,
      quantity   as Quantity,
      created_on as CreatedOn
}
