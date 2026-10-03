CLASS ltcl_source DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS types FOR TESTING.
    METHODS include_xml FOR TESTING.
ENDCLASS.
CLASS ltcl_source IMPLEMENTATION.
  METHOD types.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_source=>source_type( `/sap/bc/adt/programs/includes/:name/source/main` ) exp = `INCL` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_source=>source_type( `/sap/bc/adt/ddic/ddl/sources/:name` ) exp = `DDLS` ).
  ENDMETHOD.
  METHOD include_xml.
    DATA lv_body TYPE string.
    lv_body = zcl_osd_adt_source=>include_document( iv_name = `A&B` iv_include = `main` iv_uri = `x?a=1&b=2` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*adtcore:name="A&amp;B"*href="x?a=1&amp;b=2"*` ).
  ENDMETHOD.
ENDCLASS.
