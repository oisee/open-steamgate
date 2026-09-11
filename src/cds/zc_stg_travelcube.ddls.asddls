@AbapCatalog.sqlViewName: 'ZVSTGTRAVELCUBE'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travels by status (analytical cube for the SADL demo)'
@Analytics.dataCategory: #CUBE
@OData.publish: true
define view ZC_STG_TRAVELCUBE
  as select from zstg_demo
{
      @EndUserText.label: 'Travel'
      @UI.lineItem: [{ position: 10 }]
  key travel_id   as TravelId,
      @EndUserText.label: 'Status'
      @UI.lineItem: [{ position: 20 }]
      @UI.selectionField: [{ position: 10 }]
      status      as Status,
      @EndUserText.label: 'Seats'
      @Aggregation.default: #SUM
      @UI.lineItem: [{ position: 30 }]
      seats       as Seats
}
