* abapiti 037: cl_http_utility=>decode_base64 is @KERNEL in open-abap-core
* (Buffer.from(encoded, "base64").toString()): the bytes read as UTF-8
CLASS ltcl_decode DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS ascii FOR TESTING.
    METHODS utf8 FOR TESTING.
    METHODS unpadded FOR TESTING.
ENDCLASS.
CLASS ltcl_decode IMPLEMENTATION.
  METHOD ascii.
    cl_abap_unit_assert=>assert_equals( act = zcl_osgt_decode_base64=>run( `YWJhcA==` ) exp = `abap` ).
  ENDMETHOD.
  METHOD utf8.
    " c3 a4 is a-umlaut in UTF-8: one character
    cl_abap_unit_assert=>assert_equals( act = strlen( zcl_osgt_decode_base64=>run( `w6Q=` ) ) exp = 1 ).
  ENDMETHOD.
  METHOD unpadded.
    cl_abap_unit_assert=>assert_equals( act = zcl_osgt_decode_base64=>run( `YWJhcA` ) exp = `abap` ).
  ENDMETHOD.
ENDCLASS.
