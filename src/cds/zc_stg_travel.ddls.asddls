@AbapCatalog.sqlViewName: 'ZVSTGTRAVEL'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel (CDS projection for the SADL demo)'
@OData.publish: true
define view ZC_STG_TRAVEL
  as select from zstg_demo
  association [0..*] to ZC_STG_BOOKING as _Bookings on $projection.TravelId = _Bookings.TravelId
{
      @EndUserText.label: 'Travel'
  key travel_id   as TravelId,
      @EndUserText.label: 'Description'
      description as Description,
      @EndUserText.label: 'Status'
      status      as Status,
      @EndUserText.label: 'Seats'
      seats       as Seats,
      // no column behind these two: zcl_stg_travel_calc fills them after the
      // read, from the row itself and from what the bookings say
      @EndUserText.label: 'Occupancy'
      @ObjectModel.virtualElement: true
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_STG_TRAVEL_CALC'
      cast( '' as abap.char( 12 ) ) as Occupancy,
      @EndUserText.label: 'Free seats'
      @ObjectModel.virtualElement: true
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_STG_TRAVEL_CALC'
      cast( 0 as abap.int4 ) as FreeSeats,
      _Bookings
}
