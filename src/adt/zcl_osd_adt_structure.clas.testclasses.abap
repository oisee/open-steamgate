CLASS ltcl_structure DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS empty FOR TESTING RAISING zcx_ajson_error.
    METHODS root_links FOR TESTING RAISING zcx_ajson_error.
    METHODS nested FOR TESTING RAISING zcx_ajson_error.
ENDCLASS.
CLASS ltcl_structure IMPLEMENTATION.
  METHOD empty.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_xml TYPE string.
    lo_json = zcl_ajson=>parse( `{"name":"Z","type":"DDLS/DF","children":[]}` ).
    lv_xml = zcl_osd_adt_structure=>document( io_json = lo_json iv_base = `/a?x=1&y=2` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*xml:base="/a?x=1&amp;y=2"*` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*adtcore:type="DDLS/DF">` && cl_abap_char_utilities=>newline
      && cl_abap_char_utilities=>newline && `</abapsource:*` ).
  ENDMETHOD.
  METHOD root_links.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_xml TYPE string.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    lo_json = zcl_ajson=>parse( `{"name":"Z","type":"INTF/OI","links":[{"rel":"definitionIdentifier","href":"source/main"}],"children":[]}` ).
    lv_xml = zcl_osd_adt_structure=>document( io_json = lo_json iv_base = `/a` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*href="source/main"/>` && lv_nl
      && `</abapsource:objectStructureElement>` && lv_nl ).
  ENDMETHOD.
  METHOD nested.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_xml TYPE string.
    lo_json = zcl_ajson=>parse( `{"name":"Z","type":"CLAS/OC","children":[{"name":"A","type":"X","links":[{"rel":"definitionBlock","href":"a&b"}],"extra":[{"name":"z","value":"1"},{"name":"a","value":"2"}],"children":[{"name":"B","type":"Y"}]}]}` ).
    lv_xml = zcl_osd_adt_structure=>document( io_json = lo_json iv_base = `/a` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*z="1" a="2"*` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*definitionBlock" href="a&amp;b"*` ).
    cl_abap_unit_assert=>assert_false( boolc( lv_xml CS `definitionIdentifier` ) ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_xml exp = `*    <abapsource:objectStructureElement adtcore:name="B"*` ).
  ENDMETHOD.
ENDCLASS.
