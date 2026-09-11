CLASS ltcl_url DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS entity_set FOR TESTING RAISING cx_static_check.
    METHODS entity_with_key FOR TESTING RAISING cx_static_check.
    METHODS count FOR TESTING RAISING cx_static_check.
    METHODS metadata_and_root FOR TESTING RAISING cx_static_check.
    METHODS keys_named FOR TESTING RAISING cx_static_check.
    METHODS not_odata FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_url IMPLEMENTATION.

  METHOD entity_set.
    DATA ls_request TYPE zcl_stg_url=>ty_request.
    DATA lt_options TYPE tihttpnvp.
    DATA ls_option  LIKE LINE OF lt_options.

    ls_option-name = '$top'.
    ls_option-value = '2'.
    APPEND ls_option TO lt_options.

    ls_request = zcl_stg_url=>parse( iv_path    = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                                     it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-service
                                        exp = 'ZSTG_DEMO_SRV' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-entity_set
                                        exp = 'TravelSet' ).
    cl_abap_unit_assert=>assert_initial( ls_request-key_string ).
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_url=>option( is_request = ls_request
                                                                   iv_name    = '$TOP' )
                                        exp = '2' ).
  ENDMETHOD.

  METHOD entity_with_key.
    DATA ls_request TYPE zcl_stg_url=>ty_request.
    DATA lt_names   TYPE string_table.
    DATA lt_keys    TYPE /iwbep/t_mgw_name_value_pair.
    DATA ls_key     LIKE LINE OF lt_keys.

    ls_request = zcl_stg_url=>parse( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(%27T0001%27)' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-key_string
                                        exp = '''T0001''' ).

    APPEND 'TravelId' TO lt_names.
    lt_keys = zcl_stg_url=>parse_keys( iv_key_string = ls_request-key_string
                                       it_key_names  = lt_names ).
    READ TABLE lt_keys INDEX 1 INTO ls_key.
    cl_abap_unit_assert=>assert_equals( act = ls_key-name
                                        exp = 'TravelId' ).
    cl_abap_unit_assert=>assert_equals( act = ls_key-value
                                        exp = 'T0001' ).
  ENDMETHOD.

  METHOD keys_named.
    DATA lt_names TYPE string_table.
    DATA lt_keys  TYPE /iwbep/t_mgw_name_value_pair.
    DATA ls_key   LIKE LINE OF lt_keys.

    APPEND 'A' TO lt_names.
    APPEND 'B' TO lt_names.
    lt_keys = zcl_stg_url=>parse_keys( iv_key_string = 'A=''x''''y'',B=2'
                                       it_key_names  = lt_names ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_keys )
                                        exp = 2 ).
    READ TABLE lt_keys INDEX 1 INTO ls_key.
    cl_abap_unit_assert=>assert_equals( act = ls_key-value
                                        exp = 'x''y' ).
    READ TABLE lt_keys INDEX 2 INTO ls_key.
    cl_abap_unit_assert=>assert_equals( act = ls_key-name
                                        exp = 'B' ).
    cl_abap_unit_assert=>assert_equals( act = ls_key-value
                                        exp = '2' ).
  ENDMETHOD.

  METHOD count.
    DATA ls_request TYPE zcl_stg_url=>ty_request.

    ls_request = zcl_stg_url=>parse( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet/$count' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-entity_set
                                        exp = 'TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-is_count
                                        exp = abap_true ).
  ENDMETHOD.

  METHOD metadata_and_root.
    DATA ls_request TYPE zcl_stg_url=>ty_request.

    ls_request = zcl_stg_url=>parse( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-is_metadata
                                        exp = abap_true ).
    ls_request = zcl_stg_url=>parse( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-is_service_root
                                        exp = abap_true ).
    ls_request = zcl_stg_url=>parse( '/sap/opu/odata/sap/ZSTG_DEMO_SRV' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-is_service_root
                                        exp = abap_true ).
  ENDMETHOD.

  METHOD not_odata.
    DATA lx_error TYPE REF TO zcx_stg_error.

    TRY.
        zcl_stg_url=>parse( '/hello' ).
        cl_abap_unit_assert=>fail( 'expected zcx_stg_error' ).
      CATCH zcx_stg_error INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status
                                            exp = 404 ).
    ENDTRY.
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_json DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS values FOR TESTING RAISING cx_static_check.
    METHODS escape FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_json IMPLEMENTATION.

  METHOD values.
    DATA lv_int  TYPE i VALUE 42.
    DATA lv_char TYPE c LENGTH 10 VALUE 'ab'.
    DATA lv_bool TYPE abap_bool VALUE abap_true.
    DATA lv_date TYPE d VALUE '20240102'.
    DATA lv_time TYPE t VALUE '102030'.

    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>value( iv_value = lv_int iv_edm_type = 'Edm.Int32' )
                                        exp = '42' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>value( iv_value = lv_char iv_edm_type = 'Edm.String' )
                                        exp = '"ab"' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>value( iv_value = lv_bool iv_edm_type = 'Edm.Boolean' )
                                        exp = 'true' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>value( iv_value = lv_date iv_edm_type = 'Edm.DateTime' )
                                        exp = '"\/Date(1704153600000)\/"' ).
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>value( iv_value = lv_time iv_edm_type = 'Edm.Time' )
                                        exp = '"PT10H20M30S"' ).
  ENDMETHOD.

  METHOD escape.
    cl_abap_unit_assert=>assert_equals( act = zcl_stg_json=>escape( 'a"b\c' )
                                        exp = 'a\"b\\c' ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_dispatch DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS entity_set FOR TESTING RAISING cx_static_check.
    METHODS paging_and_inlinecount FOR TESTING RAISING cx_static_check.
    METHODS entity_by_key FOR TESTING RAISING cx_static_check.
    METHODS count FOR TESTING RAISING cx_static_check.
    METHODS metadata FOR TESTING RAISING cx_static_check.
    METHODS service_document FOR TESTING RAISING cx_static_check.
    METHODS unknown_set FOR TESTING RAISING cx_static_check.
    METHODS unknown_key FOR TESTING RAISING cx_static_check.
    METHODS unknown_service FOR TESTING RAISING cx_static_check.
    METHODS post_not_implemented FOR TESTING RAISING cx_static_check.

    METHODS get
      IMPORTING
        iv_path            TYPE string
        iv_query           TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.
ENDCLASS.

CLASS ltcl_dispatch IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD get.
    DATA lt_options TYPE tihttpnvp.

    IF iv_query IS NOT INITIAL.
      lt_options = cl_http_utility=>string_to_fields( iv_query ).
    ENDIF.
    rs_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = iv_path
                                                it_options = lt_options ).
  ENDMETHOD.

  METHOD entity_set.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
                                        exp = 'application/json' ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '{"d":{"results":[{"__metadata":{"id":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0001'')"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"type":"ZSTG_DEMO_SRV.Travel"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0001","Description":"Berlin to Copenhagen","Status":"A","Seats":2}' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'TravelSet(''T0009'')' ) ).
  ENDMETHOD.

  METHOD paging_and_inlinecount.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                       iv_query = '$top=1&$skip=1&$inlinecount=allpages&$orderby=TravelId%20desc' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0002"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"TravelId":"T0001"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"__count":"1"' ) ).
  ENDMETHOD.

  METHOD entity_by_key.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0003'')' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '{"d":{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Description":"Aarhus to Odense"' ) ).

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(TravelId=''T0003'')' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
  ENDMETHOD.

  METHOD count.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet/$count' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-content_type
                                        exp = 'text/plain' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '4' ).
  ENDMETHOD.

  METHOD metadata.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<EntitySet Name="TravelSet" EntityType="ZSTG_DEMO_SRV.Travel"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Property Name="Seats" Type="Edm.Int32"' ) ).
  ENDMETHOD.

  METHOD service_document.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '{"d":{"EntitySets":["TravelSet"]}}' ).
  ENDMETHOD.

  METHOD unknown_set.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/NopeSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"code":"STG/ENTITY_SET_NOT_FOUND"' ) ).
  ENDMETHOD.

  METHOD unknown_key.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''NOPE'')' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
  ENDMETHOD.

  METHOD unknown_service.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZNOPE_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"code":"STG/SERVICE_NOT_FOUND"' ) ).
  ENDMETHOD.

  METHOD post_not_implemented.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'POST'
                                                iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 501 ).
  ENDMETHOD.

ENDCLASS.
