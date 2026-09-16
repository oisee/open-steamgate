@AbapCatalog.sqlViewName: 'ZVOSDTESTITEM'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'ZOSD_TEST: demo items (CDS projection)'
define view ZOSD_TEST_I_ITEM
  as select from zosd_test_item
{
  key item_id    as ItemId,
      name       as Name,
      status     as Status,
      quantity   as Quantity,
      created_on as CreatedOn
}
