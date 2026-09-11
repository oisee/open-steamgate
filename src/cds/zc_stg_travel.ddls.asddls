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
      _Bookings
}
