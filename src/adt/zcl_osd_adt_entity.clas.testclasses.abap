CLASS ltcl_helper DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS tags FOR TESTING RAISING cx_static_check.
    METHODS responses FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_helper IMPLEMENTATION.
  METHOD tags.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_entity=>tag( `abc` ) exp = `ba7816bf8f01cfea414140de5dae2223` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_entity=>normalized( ` W/"abc" ` ) exp = `abc` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_entity=>normalized( `"a", "b"` ) exp = `a", "b` ).
  ENDMETHOD.
  METHOD responses.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA ls_header TYPE ihttpnvp.
    ls_response = zcl_osd_adt_entity=>send( is_request = ls_request iv_body = `abc` iv_type = `text/plain` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type exp = `text/plain; charset=utf-8` ).
    ls_response = zcl_osd_adt_entity=>send( is_request = ls_request iv_body = `abc`
      iv_type = `application/atom+xml;type=feed` iv_charset = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type exp = `application/atom+xml;type=feed` ).
    ls_header-name = `If-None-Match`.
    ls_header-value = `"other", W/"ba7816bf8f01cfea414140de5dae2223"`.
    APPEND ls_header TO ls_request-headers.
    ls_response = zcl_osd_adt_entity=>send( is_request = ls_request iv_body = `abc` iv_type = `text/plain` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 304 ).
    cl_abap_unit_assert=>assert_initial( ls_response-body ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type exp = `text/plain; charset=utf-8` ).
  ENDMETHOD.
ENDCLASS.
