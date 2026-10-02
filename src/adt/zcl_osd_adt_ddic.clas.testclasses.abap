CLASS ltcl_ddic DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS unknown_pattern FOR TESTING RAISING cx_static_check.
    METHODS parsing FOR TESTING.
    METHODS source FOR TESTING.
    METHODS parser_miss FOR TESTING RAISING cx_static_check.
ENDCLASS.
CLASS ltcl_ddic IMPLEMENTATION.
  METHOD unknown_pattern.
    DATA li_route TYPE REF TO zif_osd_adt_route.
    DATA ls_request TYPE zif_osd_adt_route=>ty_request.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CREATE OBJECT li_route TYPE zcl_osd_adt_ddic.
    ls_request-pattern = `/sap/bc/adt/ddic/unknown`.
    TRY.
        li_route->handle( ls_request ).
        cl_abap_unit_assert=>fail( `expected an internal error for an unknown pattern` ).
      CATCH zcx_osd_adt INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status exp = 500 ).
        cl_abap_unit_assert=>assert_equals( act = lx_error->miss exp = zcx_osd_adt=>c_miss_none ).
        cl_abap_unit_assert=>assert_char_cp( act = lx_error->document( ) exp = `*ExceptionInternalError*` ).
    ENDTRY.
  ENDMETHOD.
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
  METHOD parsing.
    DATA lv_xml TYPE string.
    DATA ls_table TYPE zcl_osd_adt_ddic=>ty_table.
    lv_xml = `<DDTEXT>&lt;&gt;&quot;&amp;&apos;&#39;</DDTEXT><DDTEXT>later</DDTEXT>`.
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_ddic=>tag( iv_xml = lv_xml iv_tag = `DDTEXT` ) exp = `<>"&&apos;&#39;` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_ddic=>js_int( `  -00015tail` ) exp = `-15` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_ddic=>js_int( `x1` ) exp = `NaN` ).
    cl_abap_unit_assert=>assert_equals( act = zcl_osd_adt_ddic=>js_int( `` ) exp = `0` ).
    ls_table = zcl_osd_adt_ddic=>table_fields( iv_name = `ZT` iv_xml = `<DD03P_TABLE><DD03P><FIELDNAME>.INCLUDE</FIELDNAME></DD03P><DD03P><FIELDNAME>A</FIELDNAME><ROLLNAME>ZD</ROLLNAME></DD03P></DD03P_TABLE>` ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_table-fields ) exp = 1 ).
    cl_abap_unit_assert=>assert_equals( act = ls_table-delivery exp = `A` ).
  ENDMETHOD.
  METHOD source.
    DATA ls_table TYPE zcl_osd_adt_ddic=>ty_table.
    DATA ls_field TYPE zcl_osd_adt_ddic=>ty_field.
    DATA lv_body TYPE string.
    ls_table-name = `ZT`.
    ls_table-description = `O'Brien`.
    ls_table-delivery = `A`.
    ls_table-maintenance = `#RESTRICTED`.
    ls_field-name = `A`.
    ls_field-datatype = `DEC`.
    ls_field-length = `15`.
    ls_field-decimals = `2`.
    ls_field-key = abap_true.
    APPEND ls_field TO ls_table-fields.
    ls_field-name = `LONG_NAME`.
    ls_field-datatype = `RSTR`.
    ls_field-length = `0`.
    ls_field-key = abap_false.
    APPEND ls_field TO ls_table-fields.
    lv_body = zcl_osd_adt_ddic=>table_source( ls_table ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*'O''Brien'*` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*  key a         : abap.dec(15,2);*` ).
    cl_abap_unit_assert=>assert_char_cp( act = lv_body exp = `*      long_name : abap.rawstring(0);*` ).
  ENDMETHOD.
ENDCLASS.
