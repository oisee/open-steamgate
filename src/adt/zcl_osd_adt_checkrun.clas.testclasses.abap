CLASS ltcl_protocol DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS content FOR TESTING.
    METHODS reporters FOR TESTING.
ENDCLASS.
CLASS ltcl_protocol IMPLEMENTATION.
  METHOD content.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_checkrun=>decode_content( ` &lt;&amp; ` ) exp = `<&` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_checkrun=>decode_content( `REPORT ztest` ) exp = `REPORT ztest` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_checkrun=>decode_content( `YQo` ) exp = `a` && cl_abap_char_utilities=>newline ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_checkrun=>decode_content( `/wo=` ) exp = `/wo=` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_checkrun=>decode_content( `` ) exp = `` ).
  ENDMETHOD.
  METHOD reporters.
    DATA lv_xml TYPE string.
    lv_xml = zcl_osd_adt_checkrun=>reporters( ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*<chkrun:supportedType>CLAS*</chkrun:supportedType>*` ).
  ENDMETHOD.
ENDCLASS.
