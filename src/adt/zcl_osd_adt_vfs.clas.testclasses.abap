CLASS ltcl_vfs DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS raw_response FOR TESTING.
ENDCLASS.
CLASS ltcl_vfs IMPLEMENTATION.
  METHOD raw_response.
    DATA ls_response TYPE zif_osd_adt_route=>ty_response.
    DATA lv_body TYPE string.
    lv_body = `<vfs:raw value="&amp;&lt;"/>` && cl_abap_char_utilities=>newline.
    ls_response = zcl_osd_adt_vfs=>response( lv_body ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body exp = lv_body ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
      exp = `application/vnd.sap.adt.repository.virtualfolders.result.v1+xml; charset=utf-8` ).
    cl_abap_unit_assert=>assert_initial( ls_response-headers ).
  ENDMETHOD.
ENDCLASS.
