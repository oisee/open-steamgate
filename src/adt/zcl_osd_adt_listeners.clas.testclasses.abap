CLASS ltcl_listeners DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS empty_probe FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_listeners IMPLEMENTATION.
  METHOD empty_probe.
    DATA lo_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lt_methods TYPE string_table.
    CREATE OBJECT lo_route TYPE zcl_osd_adt_listeners.
    APPEND `GET` TO lt_methods.
    APPEND `POST` TO lt_methods.
    APPEND `DELETE` TO lt_methods.
    LOOP AT lt_methods INTO ls_request-method.
      ls_response = lo_route->handle( ls_request ).
      cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
      cl_abap_unit_assert=>assert_initial( ls_response-content_type ).
      cl_abap_unit_assert=>assert_initial( ls_response-body ).
      cl_abap_unit_assert=>assert_initial( ls_response-headers ).
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
