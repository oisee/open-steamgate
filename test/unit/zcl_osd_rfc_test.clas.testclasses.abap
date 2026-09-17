* The RFC channel, from the two ends a caller meets it at: the registry that
* says what may be called, and the channel that calls it. Both run without a
* listener, which is the point of keeping the HTTP shell empty.
CLASS ltcl_registry DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS the_demo_group_is_registered FOR TESTING RAISING cx_static_check.
    METHODS a_local_module_is_not_exposed FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_module_is_nothing FOR TESTING RAISING cx_static_check.
    METHODS the_signature_is_the_interface FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_registry IMPLEMENTATION.

  METHOD the_demo_group_is_registered.
    DATA ls_function TYPE zcl_osd_fm_registry=>ty_function.

    ls_function = zcl_osd_fm_registry=>get( 'Z_OSD_TEST_STATUS_TEXT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-fgroup
                                        exp = 'ZOSD_TEST_FG' ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-remote
                                        exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-implemented
                                        exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-exposed
                                        exp = abap_true ).
*   the name is matched the way a caller spells it, in any case
    ls_function = zcl_osd_fm_registry=>get( 'z_osd_test_status_text' ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-name
                                        exp = 'Z_OSD_TEST_STATUS_TEXT' ).
  ENDMETHOD.

  METHOD a_local_module_is_not_exposed.
    DATA ls_function TYPE zcl_osd_fm_registry=>ty_function.
    DATA ls_result   TYPE zcl_osd_fm_call=>ty_result.

*   it exists, it is implemented, and it is still nobody's to call: no
*   REMOTE_CALL in the function group
    ls_function = zcl_osd_fm_registry=>get( 'Z_OSD_TEST_LOCAL_ONLY' ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-implemented
                                        exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-remote
                                        exp = abap_false ).
    cl_abap_unit_assert=>assert_equals( act = ls_function-exposed
                                        exp = abap_false ).

*   and the generated dispatcher has no body for it either, so the gate is
*   not one check that somebody could forget to write twice
    ls_result = zcl_osd_fm_call=>call( iv_name = 'Z_OSD_TEST_LOCAL_ONLY'
                                       iv_json = '{}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-handled
                                        exp = abap_false ).
  ENDMETHOD.

  METHOD an_unknown_module_is_nothing.
    DATA ls_function  TYPE zcl_osd_fm_registry=>ty_function.
    DATA lt_parameter TYPE zcl_osd_fm_registry=>tt_parameter.

    ls_function = zcl_osd_fm_registry=>get( 'Z_NO_SUCH_MODULE' ).
    cl_abap_unit_assert=>assert_initial( ls_function ).
    lt_parameter = zcl_osd_fm_registry=>parameters( 'Z_NO_SUCH_MODULE' ).
    cl_abap_unit_assert=>assert_initial( lt_parameter ).
  ENDMETHOD.

  METHOD the_signature_is_the_interface.
    DATA lt_parameter TYPE zcl_osd_fm_registry=>tt_parameter.
    DATA ls_parameter TYPE zcl_osd_fm_registry=>ty_parameter.

*   what a client has to know before it can call anything: the parameters in
*   declaration order, with their DDIC types, exceptions last
    lt_parameter = zcl_osd_fm_registry=>parameters( 'Z_OSD_TEST_ITEM_LIST' ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_parameter )
                                        exp = 4 ).

    READ TABLE lt_parameter INDEX 1 INTO ls_parameter.
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-kind
                                        exp = 'IMPORTING' ).
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-name
                                        exp = 'IV_STATUS' ).
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-type
                                        exp = 'ZOSD_TEST_STATUS' ).
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-optional
                                        exp = abap_true ).

    READ TABLE lt_parameter INDEX 3 INTO ls_parameter.
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-kind
                                        exp = 'TABLES' ).
*   a TABLES parameter names its line type, which is what a caller needs to
*   build a row; OF_TABLE is what says so
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-type
                                        exp = 'ZOSD_TEST_ITEM_S' ).
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-of_table
                                        exp = abap_true ).

    READ TABLE lt_parameter INDEX 4 INTO ls_parameter.
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-kind
                                        exp = 'EXCEPTION' ).
    cl_abap_unit_assert=>assert_equals( act = ls_parameter-name
                                        exp = 'UNKNOWN_STATUS' ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_channel DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS contains
      IMPORTING iv_body   TYPE string
                iv_needle TYPE string.

    METHODS the_channel_says_what_it_is FOR TESTING RAISING cx_static_check.
    METHODS a_scalar_call FOR TESTING RAISING cx_static_check.
    METHODS a_call_with_a_table FOR TESTING RAISING cx_static_check.
    METHODS an_exception_is_not_an_error FOR TESTING RAISING cx_static_check.
    METHODS a_local_module_is_refused FOR TESTING RAISING cx_static_check.
    METHODS an_unknown_module_is_not_found FOR TESTING RAISING cx_static_check.
    METHODS a_call_is_a_post FOR TESTING RAISING cx_static_check.
    METHODS an_omitted_import_is_initial FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_channel IMPLEMENTATION.

  METHOD contains.
    IF iv_body NS iv_needle.
      cl_abap_unit_assert=>fail( |expected { iv_needle } in { iv_body }| ).
    ENDIF.
  ENDMETHOD.

  METHOD the_channel_says_what_it_is.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'GET'
                                               iv_path   = '/'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
                                        exp = 'application/json' ).
    contains( iv_body   = ls_response-body
              iv_needle = '"CHANNEL":"open-steamgate RFC channel"' ).

*   the catalogue names every module, exposed or not
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'GET'
                                               iv_path   = '/functions'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"NAME":"Z_OSD_TEST_STATUS_TEXT"' ).
    contains( iv_body   = ls_response-body
              iv_needle = '"NAME":"Z_OSD_TEST_LOCAL_ONLY"' ).

*   and one of them describes its interface
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'GET'
                                               iv_path   = '/functions/Z_OSD_TEST_ITEM_LIST'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"KIND":"TABLES"' ).
  ENDMETHOD.

  METHOD a_scalar_call.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_STATUS_TEXT'
                                               iv_body   = '{"IMPORTING":{"IV_STATUS":"N"}}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals(
      act = ls_response-body
      exp = '{"FUNCTION":"Z_OSD_TEST_STATUS_TEXT","EXPORTING":{"EV_TEXT":"New"}}' ).
  ENDMETHOD.

  METHOD a_call_with_a_table.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

*   the seeded rows, through a TABLES parameter and a DDIC row type
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_ITEM_LIST'
                                               iv_body   = '{"IMPORTING":{"IV_STATUS":"O"}}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"EV_COUNT":2' ).
    contains( iv_body   = ls_response-body
              iv_needle = '"ITEM_ID":"I0002"' ).
    contains( iv_body   = ls_response-body
              iv_needle = '"ITEM_ID":"I0003"' ).
  ENDMETHOD.

  METHOD an_exception_is_not_an_error.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

*   A classic exception leaves the conversation intact, which is what an RFC
*   client is told, so it is a field of a 200 and not an HTTP failure. The
*   outputs are empty, the way a raising module returns none.
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_ITEM_LIST'
                                               iv_body   = '{"IMPORTING":{"IV_STATUS":"Q"}}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals(
      act = ls_response-body
      exp = '{"FUNCTION":"Z_OSD_TEST_ITEM_LIST","EXCEPTION":"UNKNOWN_STATUS"}' ).
  ENDMETHOD.

  METHOD a_local_module_is_refused.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_LOCAL_ONLY'
                                               iv_body   = '{}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 403 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"ERROR":"FUNCTION_NOT_REMOTE_ENABLED"' ).
  ENDMETHOD.

  METHOD an_unknown_module_is_not_found.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_NO_SUCH_MODULE'
                                               iv_body   = '{}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"ERROR":"FU_NOT_FOUND"' ).
  ENDMETHOD.

  METHOD a_call_is_a_post.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'GET'
                                               iv_path   = '/call/Z_OSD_TEST_STATUS_TEXT'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 405 ).

    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'GET'
                                               iv_path   = '/nonsense'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"ERROR":"NO_SUCH_ROUTE"' ).
  ENDMETHOD.

  METHOD an_omitted_import_is_initial.
    DATA ls_response TYPE zcl_osd_rfc_channel=>ty_response.

*   an optional import the caller leaves out arrives as the type's initial
*   value, and the demo module reads that as "every status"
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_ITEM_LIST'
                                               iv_body   = '{}' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"EV_COUNT":6' ).

*   and a body that is not there at all is the same thing
    ls_response = zcl_osd_rfc_channel=>handle( iv_method = 'POST'
                                               iv_path   = '/call/Z_OSD_TEST_ITEM_LIST'
                                               iv_body   = '' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    contains( iv_body   = ls_response-body
              iv_needle = '"EV_COUNT":6' ).
  ENDMETHOD.

ENDCLASS.
