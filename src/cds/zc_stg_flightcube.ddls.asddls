@AbapCatalog.sqlViewName: 'ZVSTGFLIGHTCUBE'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Flight bookings by airline, month and status (analytical cube)'
@Analytics.dataCategory: #CUBE
@OData.publish: true
define view ZC_STG_FLIGHTCUBE
  as select from zstg_flightfact
{
      @EndUserText.label: 'Fact'
  key fact_id      as FactId,
      @EndUserText.label: 'Airline'
      @UI.selectionField: [{ position: 10 }]
      @UI.lineItem: [{ position: 10 }]
      airline      as Airline,
      @EndUserText.label: 'Month'
      @UI.selectionField: [{ position: 20 }]
      @UI.lineItem: [{ position: 20 }]
      flight_month as FlightMonth,
      @EndUserText.label: 'Status'
      @UI.selectionField: [{ position: 30 }]
      @UI.lineItem: [{ position: 30 }]
      status       as Status,
      @EndUserText.label: 'Currency'
      currency     as Currency,
      @EndUserText.label: 'Seats'
      @Aggregation.default: #SUM
      @UI.lineItem: [{ position: 40 }]
      seats        as Seats,
      @EndUserText.label: 'Revenue'
      @Aggregation.default: #SUM
      @UI.lineItem: [{ position: 50 }]
      price        as Revenue
}
