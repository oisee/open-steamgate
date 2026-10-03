* Install a test continuation in the child without changing shipped routes.
CLASS zcl_osd_adt_front_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_adt_front_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lt_routes TYPE zcl_osd_adt_router=>tt_route.
    DATA lt_real TYPE zcl_osd_adt_router=>tt_route.
    DATA ls_route TYPE zcl_osd_adt_router=>ty_route.
    ls_route-method = '*'.
    ls_route-pattern = '/sap/bc/adt/osd/test/continuation'.
    ls_route-handler = 'ZCL_OSD_ADT_ROUTE_ECHO'.
    ls_route-served_by = 'ABAP'.
    APPEND ls_route TO lt_routes.
    lt_real = zcl_osd_adt_router=>routes( ).
    APPEND LINES OF lt_real TO lt_routes.
    zcl_osd_adt_handler=>use_routes( lt_routes ).
    out->write( 'installed' ).
  ENDMETHOD.
ENDCLASS.
