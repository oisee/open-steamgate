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

* a verb the dispatcher does not know stays an honest 501
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'OPTIONS'
                                                iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 501 ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_filter DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    DATA ms_set TYPE zcl_stg_model_info=>ty_entity_set.

    METHODS setup.
    METHODS eq_string FOR TESTING RAISING cx_static_check.
    METHODS and_two_properties FOR TESTING RAISING cx_static_check.
    METHODS or_same_property FOR TESTING RAISING cx_static_check.
    METHODS ge_le_to_bt FOR TESTING RAISING cx_static_check.
    METHODS functions FOR TESTING RAISING cx_static_check.
    METHODS ne_and_not FOR TESTING RAISING cx_static_check.
    METHODS quotes_in_value FOR TESTING RAISING cx_static_check.
    METHODS not_expressible FOR TESTING RAISING cx_static_check.
    METHODS unknown_property FOR TESTING RAISING cx_static_check.
    METHODS typed_literals FOR TESTING RAISING cx_static_check.
    METHODS through_dispatcher FOR TESTING RAISING cx_static_check.

    METHODS parse
      IMPORTING
        iv_filter        TYPE string
      RETURNING
        VALUE(rt_filter) TYPE /iwbep/t_mgw_select_option
      RAISING
        cx_static_check.

    METHODS option
      IMPORTING
        it_filter        TYPE /iwbep/t_mgw_select_option
        iv_property      TYPE string
        iv_index         TYPE i DEFAULT 1
      RETURNING
        VALUE(rs_option) TYPE /iwbep/s_cod_select_option.
ENDCLASS.

CLASS ltcl_filter IMPLEMENTATION.

  METHOD setup.
    DATA ls_service TYPE zcl_stg_model_info=>ty_service.

    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
    ls_service = zcl_stg_model_info=>get( 'ZSTG_DEMO_SRV' ).
    ms_set = zcl_stg_model_info=>find_set( is_service    = ls_service
                                           iv_entity_set = 'TravelSet' ).
  ENDMETHOD.

  METHOD parse.
    rt_filter = zcl_stg_filter=>parse( iv_filter = iv_filter
                                       is_set    = ms_set ).
  ENDMETHOD.

  METHOD option.
    DATA ls_filter LIKE LINE OF it_filter.

    READ TABLE it_filter INTO ls_filter WITH KEY property = iv_property.
    cl_abap_unit_assert=>assert_subrc( msg = |property { iv_property } missing| ).
    READ TABLE ls_filter-select_options INDEX iv_index INTO rs_option.
    cl_abap_unit_assert=>assert_subrc( msg = |option { iv_index } of { iv_property } missing| ).
  ENDMETHOD.

  METHOD eq_string.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Status eq 'A'` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_filter )
                                        exp = 1 ).
    ls_option = option( it_filter = lt_filter iv_property = 'Status' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-sign
                                        exp = 'I' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-option
                                        exp = 'EQ' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'A' ).
  ENDMETHOD.

  METHOD and_two_properties.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Status eq 'A' and TravelId ge 'T0002'` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_filter )
                                        exp = 2 ).
    ls_option = option( it_filter = lt_filter iv_property = 'TravelId' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-option
                                        exp = 'GE' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'T0002' ).
  ENDMETHOD.

  METHOD or_same_property.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `(TravelId eq 'T0001') or (TravelId eq 'T0003') or TravelId eq 'T0009'` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_filter )
                                        exp = 1 ).
    ls_option = option( it_filter = lt_filter iv_property = 'TravelId' iv_index = 3 ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'T0009' ).
  ENDMETHOD.

  METHOD ge_le_to_bt.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Seats ge 2 and Seats le 4` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Seats' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-option
                                        exp = 'BT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = '2' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-high
                                        exp = '4' ).

    lt_filter = parse( `Seats le 4 and Seats ge 2` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Seats' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-option
                                        exp = 'BT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = '2' ).
  ENDMETHOD.

  METHOD functions.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `startswith(Description,'Berlin')` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Description' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-option
                                        exp = 'CP' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'Berlin*' ).

    lt_filter = parse( `substringof('to',Description) and endswith(TravelId,'3')` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Description' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = '*to*' ).
    ls_option = option( it_filter = lt_filter iv_property = 'TravelId' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = '*3' ).

    lt_filter = parse( `tolower(Status) eq 'a'` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Status' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'a' ).
  ENDMETHOD.

  METHOD ne_and_not.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Status ne 'X' and not (Status eq 'Y')` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Status' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-sign
                                        exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'X' ).
    ls_option = option( it_filter = lt_filter iv_property = 'Status' iv_index = 2 ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-sign
                                        exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'Y' ).
  ENDMETHOD.

  METHOD quotes_in_value.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Description eq 'O''Brien (and co)'` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Description' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = `O'Brien (and co)` ).
  ENDMETHOD.

  METHOD not_expressible.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.

* OR across properties: no range can say this
    lt_filter = parse( `Status eq 'A' or Seats gt 3` ).
    cl_abap_unit_assert=>assert_initial( lt_filter ).

* two inclusive conditions on one property that are not a BT pair
    lt_filter = parse( `startswith(Description,'B') and endswith(Description,'n')` ).
    cl_abap_unit_assert=>assert_initial( lt_filter ).
  ENDMETHOD.

  METHOD unknown_property.
    DATA lx_error TYPE REF TO zcx_stg_error.

    TRY.
        parse( `Nope eq 1` ).
        cl_abap_unit_assert=>fail( 'expected zcx_stg_error' ).
      CATCH zcx_stg_error INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->status
                                            exp = 400 ).
    ENDTRY.

    TRY.
        parse( `Status eq` ).
        cl_abap_unit_assert=>fail( 'expected zcx_stg_error' ).
      CATCH zcx_stg_error INTO lx_error.
        cl_abap_unit_assert=>assert_equals( act = lx_error->code
                                            exp = 'STG/BAD_FILTER' ).
    ENDTRY.
  ENDMETHOD.

  METHOD typed_literals.
    DATA lt_filter TYPE /iwbep/t_mgw_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.

    lt_filter = parse( `Description ge datetime'2024-01-02T10:20:30' and Status eq true` ).
    ls_option = option( it_filter = lt_filter iv_property = 'Description' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = '20240102102030' ).
    ls_option = option( it_filter = lt_filter iv_property = 'Status' ).
    cl_abap_unit_assert=>assert_equals( act = ls_option-low
                                        exp = 'X' ).
  ENDMETHOD.

  METHOD through_dispatcher.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lt_options  TYPE tihttpnvp.

    lt_options = cl_http_utility=>string_to_fields( `$filter=Status%20eq%20'A'%20and%20TravelId%20ge%20'T0002'` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0002"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0009"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"TravelId":"T0001"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"TravelId":"T0003"' ) ).

    lt_options = cl_http_utility=>string_to_fields( `$filter=Nope%20eq%201` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_writes DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS parse_body FOR TESTING RAISING cx_static_check.
    METHODS create_read_update_delete FOR TESTING RAISING cx_static_check.
    METHODS create_duplicate_is_400 FOR TESTING RAISING cx_static_check.
    METHODS create_without_key_is_400 FOR TESTING RAISING cx_static_check.
    METHODS delete_unknown_is_400 FOR TESTING RAISING cx_static_check.
    METHODS bad_json_is_400 FOR TESTING RAISING cx_static_check.

    METHODS call
      IMPORTING
        iv_method          TYPE string
        iv_path            TYPE string
        iv_body            TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.
ENDCLASS.

CLASS ltcl_writes IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD call.
    rs_response = zcl_stg_dispatcher=>dispatch( iv_method = iv_method
                                                iv_path   = iv_path
                                                iv_body   = iv_body ).
  ENDMETHOD.

  METHOD parse_body.
    DATA lt_values TYPE tihttpnvp.
    DATA ls_value  LIKE LINE OF lt_values.

    lt_values = zcl_stg_json=>parse_object(
      `{"d":{"__metadata":{"type":"x"},"TravelId":"T0007","Description":"O\"Brien \\ co","Seats":3,"Flag":true,"Gone":null,"Nested":{"a":[1,2]},"Last":"z"}}` ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_values )
                                        exp = 6 ).
    READ TABLE lt_values INTO ls_value WITH KEY name = 'Description'.
    cl_abap_unit_assert=>assert_equals( act = ls_value-value
                                        exp = `O"Brien \ co` ).
    READ TABLE lt_values INTO ls_value WITH KEY name = 'Seats'.
    cl_abap_unit_assert=>assert_equals( act = ls_value-value
                                        exp = '3' ).
    READ TABLE lt_values INTO ls_value WITH KEY name = 'Flag'.
    cl_abap_unit_assert=>assert_equals( act = ls_value-value
                                        exp = 'true' ).
    READ TABLE lt_values INTO ls_value WITH KEY name = 'Last'.
    cl_abap_unit_assert=>assert_equals( act = ls_value-value
                                        exp = 'z' ).
  ENDMETHOD.

  METHOD create_read_update_delete.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA ls_header   TYPE ihttpnvp.

    ls_response = call( iv_method = 'POST'
                        iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                        iv_body   = `{"TravelId":"T0100","Description":"Odense to Berlin","Status":"A","Seats":3}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 201 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `{"d":{"__metadata":{"id":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')"` ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"Seats":3` ) ).
    READ TABLE ls_response-headers INTO ls_header WITH KEY name = 'location'.
    cl_abap_unit_assert=>assert_equals( act = ls_header-value
                                        exp = `http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')` ).

    ls_response = call( iv_method = 'GET'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"Description":"Odense to Berlin"` ) ).

    ls_response = call( iv_method = 'PUT'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')`
                        iv_body   = `{"d":{"TravelId":"T0100","Description":"Odense to Berlin, updated","Status":"X","Seats":"5"}}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 204 ).
    cl_abap_unit_assert=>assert_initial( ls_response-body ).

    ls_response = call( iv_method = 'GET'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')` ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `"Description":"Odense to Berlin, updated","Status":"X","Seats":5` ) ).

    ls_response = call( iv_method = 'DELETE'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 204 ).

    ls_response = call( iv_method = 'GET'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0100')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
  ENDMETHOD.

  METHOD create_duplicate_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                        iv_body   = `{"TravelId":"T0001","Description":"dup"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'already exists' ) ).
  ENDMETHOD.

  METHOD create_without_key_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                        iv_body   = `{"Description":"no key"}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'TravelId is required' ) ).
  ENDMETHOD.

  METHOD delete_unknown_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'DELETE'
                        iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('NOPE')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
  ENDMETHOD.

  METHOD bad_json_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = call( iv_method = 'POST'
                        iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                        iv_body   = `not json` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'STG/BAD_JSON' ) ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_batch DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS parse_retrieve_and_changeset FOR TESTING RAISING cx_static_check.
    METHODS retrieve_parts FOR TESTING RAISING cx_static_check.
    METHODS changeset_ok FOR TESTING RAISING cx_static_check.
    METHODS changeset_fails_as_a_whole FOR TESTING RAISING cx_static_check.
    METHODS boundary_missing_is_400 FOR TESTING RAISING cx_static_check.

    METHODS crlf
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS ltcl_batch IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD crlf.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF '|' IN rv_text WITH cl_abap_char_utilities=>cr_lf.
  ENDMETHOD.

  METHOD parse_retrieve_and_changeset.
    DATA lt_parts   TYPE zcl_stg_batch=>ty_parts.
    DATA ls_part    TYPE zcl_stg_batch=>ty_part.
    DATA ls_request TYPE zcl_stg_batch=>ty_request.
    DATA lv_body    TYPE string.

    lv_body = crlf( `--batch_1|Content-Type: application/http|Content-Transfer-Encoding: binary||GET TravelSet?$top=1 HTTP/1.1|Accept: application/json|||` &&
                    `--batch_1|Content-Type: multipart/mixed; boundary=changeset_2||--changeset_2|Content-Type: application/http|Content-Transfer-Encoding: binary||` &&
                    `POST TravelSet HTTP/1.1|Content-Type: application/json|Content-Length: 20||{"TravelId":"T0300"}|--changeset_2--||--batch_1--|` ).

    lt_parts = zcl_stg_batch=>parse( iv_body     = lv_body
                                     iv_boundary = 'batch_1' ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_parts )
                                        exp = 2 ).

    READ TABLE lt_parts INDEX 1 INTO ls_part.
    cl_abap_unit_assert=>assert_equals( act = ls_part-changeset
                                        exp = abap_false ).
    READ TABLE ls_part-requests INDEX 1 INTO ls_request.
    cl_abap_unit_assert=>assert_equals( act = ls_request-method
                                        exp = 'GET' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-url
                                        exp = 'TravelSet?$top=1' ).

    READ TABLE lt_parts INDEX 2 INTO ls_part.
    cl_abap_unit_assert=>assert_equals( act = ls_part-changeset
                                        exp = abap_true ).
    READ TABLE ls_part-requests INDEX 1 INTO ls_request.
    cl_abap_unit_assert=>assert_equals( act = ls_request-method
                                        exp = 'POST' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-body
                                        exp = '{"TravelId":"T0300"}' ).
  ENDMETHOD.

  METHOD retrieve_parts.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lv_body     TYPE string.

    lv_body = crlf( `--b|Content-Type: application/http|Content-Transfer-Encoding: binary||GET TravelSet?$top=1&$inlinecount=allpages HTTP/1.1||` &&
                    `--b|Content-Type: application/http|Content-Transfer-Encoding: binary||GET TravelSet('T0003') HTTP/1.1||--b--|` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method       = 'POST'
                                                iv_path         = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$batch'
                                                iv_body         = lv_body
                                                iv_content_type = 'multipart/mixed; boundary=b' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 202 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-content_type CP 'multipart/mixed; boundary=batchresponse_stg_*' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'HTTP/1.1 200 OK' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"__count":"1"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Description":"Aarhus to Odense"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'DataServiceVersion: 2.0' ) ).
  ENDMETHOD.

  METHOD changeset_ok.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lv_body     TYPE string.

    lv_body = crlf( `--b|Content-Type: multipart/mixed; boundary=cs||--cs|Content-Type: application/http|Content-Transfer-Encoding: binary||` &&
                    `POST TravelSet HTTP/1.1|Content-Type: application/json||{"TravelId":"T0301","Description":"batch","Seats":1}|` &&
                    `--cs|Content-Type: application/http|Content-Transfer-Encoding: binary||DELETE TravelSet('T0301') HTTP/1.1||--cs--||--b--|` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method       = 'POST'
                                                iv_path         = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$batch'
                                                iv_body         = lv_body
                                                iv_content_type = 'multipart/mixed; boundary=b' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 202 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'Content-Type: multipart/mixed; boundary=changesetresponse_stg_' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'HTTP/1.1 201 Created' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'HTTP/1.1 204 No Content' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS `location: http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0301')` ) ).
  ENDMETHOD.

  METHOD changeset_fails_as_a_whole.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lv_body     TYPE string.

    lv_body = crlf( `--b|Content-Type: multipart/mixed; boundary=cs||--cs|Content-Type: application/http|Content-Transfer-Encoding: binary||` &&
                    `DELETE TravelSet('NOPE') HTTP/1.1||--cs|Content-Type: application/http|Content-Transfer-Encoding: binary||` &&
                    `POST TravelSet HTTP/1.1||{"TravelId":"T0302"}|--cs--||--b--|` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method       = 'POST'
                                                iv_path         = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$batch'
                                                iv_body         = lv_body
                                                iv_content_type = 'multipart/mixed; boundary=b' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 202 ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS 'changesetresponse' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'HTTP/1.1 400 Bad Request' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '201 Created' ) ).

* the request after the failure was not run
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'
                                                iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0302')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
  ENDMETHOD.

  METHOD boundary_missing_is_400.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method       = 'POST'
                                                iv_path         = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$batch'
                                                iv_body         = 'x'
                                                iv_content_type = 'text/plain' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 400 ).
  ENDMETHOD.

ENDCLASS.
