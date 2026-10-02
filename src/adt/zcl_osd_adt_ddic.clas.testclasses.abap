CLASS ltcl_ddic DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS parser_miss FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_ddic IMPLEMENTATION.
  METHOD parser_miss.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CREATE OBJECT li_route TYPE zcl_osd_adt_ddic.
    ls_request-pattern = `/sap/bc/adt/ddic/tables/parser/info`.
    TRY.
        li_route->handle( ls_request ).
        cl_abap_unit_assert=>fail( `expected the parser resource miss` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 404 ).
        cl_abap_unit_assert=>assert_equals( act = lx_error->miss exp = zcx_osd_adt=>c_miss_resource ).
        cl_abap_unit_assert=>assert_equals( act = lx_error->message_text
          exp = `the DDL parser information is the system's own and is not served here` ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
