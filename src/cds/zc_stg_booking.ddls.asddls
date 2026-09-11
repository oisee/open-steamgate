@AbapCatalog.sqlViewName: 'ZVSTGBOOKING'
@AbapCatalog.compiler.compareFilter: true
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Booking (CDS projection for the SADL demo)'
define view ZC_STG_BOOKING
  as select from zstg_demo_bk
  association [1..1] to ZC_STG_TRAVEL as _Travel on $projection.TravelId = _Travel.TravelId
{
  key travel_id   as TravelId,
  key booking_id  as BookingId,
      customer    as Customer,
      flight_date as FlightDate,
      _Travel
}
