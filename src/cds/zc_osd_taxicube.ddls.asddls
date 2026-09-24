@AbapCatalog.sqlViewName: 'ZVOSDTAXICUBE'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'NYC taxi trips by day, hour, pickup zone and payment'
@Analytics.dataCategory: #CUBE
@OData.publish: true
define view ZC_OSD_TAXICUBE
  as select from zosd_taxifact
{
  key fact_id as FactId,
      @EndUserText.label: 'Pickup day'
      @UI.selectionField: [{ position: 10 }]
      pickup_day as PickupDay,
      @EndUserText.label: 'Hour'
      @UI.selectionField: [{ position: 20 }]
      pickup_hour as PickupHour,
      @EndUserText.label: 'Borough'
      @UI.selectionField: [{ position: 30 }]
      borough as Borough,
      @EndUserText.label: 'Pickup zone'
      @UI.selectionField: [{ position: 40 }]
      pickup_zone as Zone,
      @EndUserText.label: 'Payment'
      @UI.selectionField: [{ position: 50 }]
      payment as Payment,
      @EndUserText.label: 'Trips'
      @Aggregation.default: #SUM
      trips as Trips,
      @EndUserText.label: 'Fares (USD)'
      @Aggregation.default: #SUM
      fare as Fare,
      @EndUserText.label: 'Tips (USD)'
      @Aggregation.default: #SUM
      tip as Tip,
      @EndUserText.label: 'Distance (miles)'
      @Aggregation.default: #SUM
      distance as Distance
}
