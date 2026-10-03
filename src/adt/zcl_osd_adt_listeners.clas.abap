"! Debugger listener probes are empty, untyped 200s; CSRF is the front's gate.
CLASS zcl_osd_adt_listeners DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
ENDCLASS.

CLASS zcl_osd_adt_listeners IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    rs_response-status = 200.
  ENDMETHOD.
ENDCLASS.
