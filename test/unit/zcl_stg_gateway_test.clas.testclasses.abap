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
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0001","Description":"Berlin to Copenhagen","Status":"A","Seats":2,"to_Bookings":{"__deferred"' ) ).
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
                                        exp = '{"d":{"EntitySets":["TravelSet","BookingSet"]}}' ).
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


CLASS ltcl_navigation DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS url_with_navigation FOR TESTING RAISING cx_static_check.
    METHODS metadata_has_association FOR TESTING RAISING cx_static_check.
    METHODS to_many_navigation FOR TESTING RAISING cx_static_check.
    METHODS to_one_navigation FOR TESTING RAISING cx_static_check.
    METHODS deferred_links FOR TESTING RAISING cx_static_check.
    METHODS expand_entity_set FOR TESTING RAISING cx_static_check.
    METHODS expand_single_entity FOR TESTING RAISING cx_static_check.
    METHODS expand_nested FOR TESTING RAISING cx_static_check.
    METHODS expand_by_the_dpc FOR TESTING RAISING cx_static_check.
    METHODS unknown_navigation FOR TESTING RAISING cx_static_check.

    METHODS get
      IMPORTING
        iv_path            TYPE string
        iv_query           TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.
ENDCLASS.

CLASS ltcl_navigation IMPLEMENTATION.

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

  METHOD url_with_navigation.
    DATA ls_request TYPE zcl_stg_url=>ty_request.

    ls_request = zcl_stg_url=>parse( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Bookings` ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-entity_set
                                        exp = 'TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-key_string
                                        exp = `'T0001'` ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-nav_prop
                                        exp = 'to_Bookings' ).

    ls_request = zcl_stg_url=>parse( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Bookings/$count` ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-nav_prop
                                        exp = 'to_Bookings' ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-is_count
                                        exp = abap_true ).

    ls_request = zcl_stg_url=>parse( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Bookings(TravelId='T0001',BookingId='B001')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_request-nav_key_string
                                        exp = `TravelId='T0001',BookingId='B001'` ).
  ENDMETHOD.

  METHOD metadata_has_association.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<NavigationProperty Name="to_Bookings" Relationship="ZSTG_DEMO_SRV.TravelToBookings" FromRole="FromRole_TravelToBookings" ToRole="ToRole_TravelToBookings"/>' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<NavigationProperty Name="to_Travel" Relationship="ZSTG_DEMO_SRV.TravelToBookings" FromRole="ToRole_TravelToBookings" ToRole="FromRole_TravelToBookings"/>' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Association Name="TravelToBookings"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<End Type="ZSTG_DEMO_SRV.Booking" Multiplicity="*" Role="ToRole_TravelToBookings"/>' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<AssociationSet Name="TravelToBookingsSet" Association="ZSTG_DEMO_SRV.TravelToBookings"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Property Name="FlightDate" Type="Edm.DateTime" Nullable="true" Precision="0"' ) ).
  ENDMETHOD.

  METHOD to_many_navigation.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Bookings` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"type":"ZSTG_DEMO_SRV.Booking"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"BookingId":"B001","Customer":"Ada Lovelace","FlightDate":"\/Date(' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"BookingId":"B002"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS 'Dijkstra' ) ).

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Bookings/$count` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '2' ).

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0003')/to_Bookings` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '{"d":{"results":[]}}' ).
  ENDMETHOD.

  METHOD to_one_navigation.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/BookingSet(TravelId='T0002',BookingId='B001')/to_Travel` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '{"d":{"__metadata":{"id":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0002'')"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Description":"Copenhagen to Aarhus"' ) ).
  ENDMETHOD.

  METHOD deferred_links.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')` ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"to_Bookings":{"__deferred":{"uri":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0001'')/to_Bookings"}}' ) ).
  ENDMETHOD.

  METHOD expand_entity_set.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                       iv_query = '$expand=to_Bookings&$top=2' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0001","Description":"Berlin to Copenhagen","Status":"A","Seats":2,"to_Bookings":{"results":[{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Customer":"Grace Hopper"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Customer":"Edsger Dijkstra"' ) ).
* the expanded navigation is inline; the bookings' own to_Travel stays deferred
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"to_Bookings":{"__deferred"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"to_Travel":{"__deferred"' ) ).
  ENDMETHOD.

  METHOD expand_single_entity.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( iv_path  = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/BookingSet(TravelId='T0001',BookingId='B002')`
                       iv_query = '$expand=to_Travel' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"to_Travel":{"__metadata":{"id":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0001'')"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Description":"Berlin to Copenhagen"' ) ).

    ls_response = get( iv_path  = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0003')`
                       iv_query = '$expand=to_Bookings' ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"to_Bookings":{"results":[]}' ) ).
  ENDMETHOD.

  METHOD expand_nested.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

* Booking -> Travel -> Bookings: two levels
    ls_response = get( iv_path  = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/BookingSet(TravelId='T0001',BookingId='B001')`
                       iv_query = '$expand=to_Travel/to_Bookings' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"to_Travel":{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Description":"Berlin to Copenhagen","Status":"A","Seats":2,"to_Bookings":{"results":[' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Customer":"Grace Hopper"' ) ).
  ENDMETHOD.

  METHOD expand_by_the_dpc.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

* TravelSet?$expand=to_Bookings is served by the DPC's own
* get_expanded_entityset (tech clause TO_BOOKINGS), result is the same shape
    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
                       iv_query = '$expand=to_Bookings&$filter=TravelId%20eq%20''T0002''' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0002","Description":"Copenhagen to Aarhus","Status":"A","Seats":1,"to_Bookings":{"results":[{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Customer":"Edsger Dijkstra"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS 'Ada Lovelace' ) ).
  ENDMETHOD.

  METHOD unknown_navigation.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0001')/to_Nowhere` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 404 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'STG/NAVIGATION_NOT_FOUND' ) ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_deep_insert DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS parse_nested FOR TESTING RAISING cx_static_check.
    METHODS travel_with_bookings FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_deep_insert IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD parse_nested.
    DATA lt_values   TYPE tihttpnvp.
    DATA lt_nested   TYPE tihttpnvp.
    DATA ls_nested   TYPE ihttpnvp.
    DATA lt_elements TYPE string_table.

    lt_values = zcl_stg_json=>parse_object(
      EXPORTING iv_json   = `{"d":{"TravelId":"T1","to_Bookings":[{"BookingId":"B1"},{"BookingId":"B2","Customer":"x, y"}],"to_Travel":{"__deferred":{"uri":"u"}},"Seats":1}}`
      IMPORTING et_nested = lt_nested ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_values )
                                        exp = 2 ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_nested )
                                        exp = 1 ).
    READ TABLE lt_nested INDEX 1 INTO ls_nested.
    cl_abap_unit_assert=>assert_equals( act = ls_nested-name
                                        exp = 'to_Bookings' ).
    lt_elements = zcl_stg_json=>parse_array( ls_nested-value ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_elements )
                                        exp = 2 ).
  ENDMETHOD.

  METHOD travel_with_bookings.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch(
      iv_method = 'POST'
      iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet'
      iv_body   = `{"TravelId":"T0600","Description":"Deep","Status":"A","Seats":2,` &&
                  `"to_Bookings":[{"BookingId":"B001","Customer":"Alan Turing","FlightDate":"\/Date(1789171200000)\/"},{"BookingId":"B002","Customer":"John von Neumann"}]}` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 201 ).
* the deep entity comes back with its bookings inline
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TravelId":"T0600","Description":"Deep","Status":"A","Seats":2,"to_Bookings":{"results":[{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Customer":"Alan Turing","FlightDate":"\/Date(1789171200000)\/"' ) ).

* and it is really in the database, reachable through navigation
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'
                                                iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0600')/to_Bookings/$count` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '2' ).

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'DELETE'
                                                iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0600')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 204 ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_function_import DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS metadata_has_function_imports FOR TESTING RAISING cx_static_check.
    METHODS entity_returning_action FOR TESTING RAISING cx_static_check.
    METHODS primitive_returning_action FOR TESTING RAISING cx_static_check.
    METHODS wrong_verb_is_405 FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_function_import IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_DEMO_SRV'
                                iv_mpc     = 'ZCL_ZSTG_DEMO_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_DEMO_DPC_EXT' ).
    zcl_stg_model_info=>clear( ).
  ENDMETHOD.

  METHOD metadata_has_function_imports.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'
                                                iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<FunctionImport Name="CancelTravel" ReturnType="ZSTG_DEMO_SRV.Travel" EntitySet="TravelSet" m:HttpMethod="POST" sap:action-for="ZSTG_DEMO_SRV.Travel">' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Parameter Name="TravelId" Type="Edm.String" Mode="In" MaxLength="8"/>' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<FunctionImport Name="TravelCount" m:HttpMethod="GET">' ) ).
  ENDMETHOD.

  METHOD entity_returning_action.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lt_options  TYPE tihttpnvp.

    lt_options = cl_http_utility=>string_to_fields( `TravelId='T0002'` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'POST'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/CancelTravel'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '{"d":{"__metadata":{"id":"http://localhost/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet(''T0002'')"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"Status":"X"' ) ).

* undo for the other tests
    lt_options = cl_http_utility=>string_to_fields( `x=1` ).
    zcl_stg_dispatcher=>dispatch( iv_method = 'PUT'
                                  iv_path   = `/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelSet('T0002')`
                                  iv_body   = '{"Description":"Copenhagen to Aarhus","Status":"A","Seats":1}' ).
  ENDMETHOD.

  METHOD primitive_returning_action.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.
    DATA lt_options  TYPE tihttpnvp.

    lt_options = cl_http_utility=>string_to_fields( `Status='A'` ).
    ls_response = zcl_stg_dispatcher=>dispatch( iv_method  = 'GET'
                                                iv_path    = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/TravelCount'
                                                it_options = lt_options ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '{"d":{"TravelCount":3}}' ).
  ENDMETHOD.

  METHOD wrong_verb_is_405.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'
                                                iv_path   = '/sap/opu/odata/sap/ZSTG_DEMO_SRV/CancelTravel' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 405 ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_sadl DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS registry_from_cds FOR TESTING RAISING cx_static_check.
    METHODS sadl_definition_parses FOR TESTING RAISING cx_static_check.
    METHODS metadata_from_cds FOR TESTING RAISING cx_static_check.
    METHODS entity_set_with_filter FOR TESTING RAISING cx_static_check.
    METHODS entity_by_key_and_navigation FOR TESTING RAISING cx_static_check.
    METHODS expand FOR TESTING RAISING cx_static_check.
    METHODS analytics_group_by FOR TESTING RAISING cx_static_check.

    METHODS get
      IMPORTING
        iv_path            TYPE string
        iv_query           TYPE string OPTIONAL
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.
ENDCLASS.

CLASS ltcl_sadl IMPLEMENTATION.

  METHOD setup.
    zcl_oao_registry=>register( iv_service = 'ZSTG_SADL_SRV'
                                iv_mpc     = 'ZCL_ZSTG_SADL_MPC_EXT'
                                iv_dpc     = 'ZCL_ZSTG_SADL_DPC_EXT' ).
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

  METHOD registry_from_cds.
    DATA ls_entity TYPE zcl_stg_cds_registry=>ty_entity.
    DATA ls_field  TYPE zcl_stg_cds_registry=>ty_field.
    DATA ls_assoc  TYPE zcl_stg_cds_registry=>ty_assoc.

    ls_entity = zcl_stg_cds_registry=>get( 'ZC_STG_TRAVEL' ).
    cl_abap_unit_assert=>assert_equals( act = ls_entity-sql_view
                                        exp = 'ZVSTGTRAVEL' ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_entity-fields )
                                        exp = 4 ).
    READ TABLE ls_entity-fields INTO ls_field WITH KEY name = 'SEATS'.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_field-edm_type
                                        exp = 'Edm.Int32' ).
    READ TABLE ls_entity-fields INTO ls_field WITH KEY name = 'TRAVELID'.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_field-is_key
                                        exp = abap_true ).
    cl_abap_unit_assert=>assert_equals( act = ls_field-label
                                        exp = 'Travel' ).
    READ TABLE ls_entity-associations INTO ls_assoc INDEX 1.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_assoc-name
                                        exp = '_Bookings' ).
    cl_abap_unit_assert=>assert_equals( act = ls_assoc-target
                                        exp = 'ZC_STG_BOOKING' ).
    cl_abap_unit_assert=>assert_equals( act = lines( ls_assoc-pairs )
                                        exp = 1 ).
  ENDMETHOD.

  METHOD sadl_definition_parses.
    DATA lo_def TYPE REF TO zcl_stg_sadl_def.
    DATA ls_structure TYPE zcl_stg_sadl_def=>ty_structure.
    DATA ls_assoc     TYPE zcl_stg_sadl_def=>ty_association.

    CREATE OBJECT lo_def
      EXPORTING
        iv_sadl_xml = `<sadl:definition><sadl:dataSource type="CDS" name="A" binding="A" /><sadl:resultSet>` &&
                      `<sadl:structure name="Head" dataSource="A" maxEditMode="RO" exposure="TRUE" ><sadl:query name="Q" ></sadl:query>` &&
                      `<sadl:association name="TO_ITEMS" binding="_ITEMS" target="Item" cardinality="many" /></sadl:structure>` &&
                      `<sadl:structure name="Item" dataSource="B" exposure="TRUE" /></sadl:resultSet></sadl:definition>`.
    cl_abap_unit_assert=>assert_equals( act = lines( lo_def->mt_structures )
                                        exp = 2 ).
    ls_structure = lo_def->structure_by_set( 'HeadSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_structure-data_source
                                        exp = 'A' ).
    READ TABLE ls_structure-associations INTO ls_assoc INDEX 1.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_assoc-binding
                                        exp = '_ITEMS' ).
    cl_abap_unit_assert=>assert_equals( act = ls_assoc-target
                                        exp = 'Item' ).
  ENDMETHOD.

  METHOD metadata_from_cds.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_SADL_SRV/$metadata' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<EntityType Name="Zc_Stg_Travel"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Property Name="TRAVELID" Type="Edm.String" Nullable="false" MaxLength="8" sap:unicode="false" sap:label="Travel"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Property Name="SEATS" Type="Edm.Int32"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<NavigationProperty Name="TO_BOOKINGS" Relationship="ZSTG_SADL_SRV.Zc_Stg_Travel_TO_BOOKINGS"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<EntitySet Name="Zc_Stg_TravelSet" EntityType="ZSTG_SADL_SRV.Zc_Stg_Travel" sap:creatable="false"' ) ).
* analytics: the cube is an aggregate set with dimensions and a measure
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<EntitySet Name="Zc_Stg_TravelcubeSet" EntityType="ZSTG_SADL_SRV.Zc_Stg_Travelcube" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:pageable="true" sap:semantics="aggregate"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'sap:label="Seats" sap:creatable="false" sap:updatable="false" sap:sortable="true" sap:filterable="true" sap:aggregation-role="measure"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS 'sap:label="Status" sap:creatable="false" sap:updatable="false" sap:sortable="true" sap:filterable="true" sap:aggregation-role="dimension"' ) ).
* UI vocabulary from @UI.lineItem / @UI.selectionField
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Annotations xmlns="http://docs.oasis-open.org/odata/ns/edm" Target="ZSTG_SADL_SRV.Zc_Stg_Travelcube">' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<Annotation Term="com.sap.vocabularies.UI.v1.LineItem">' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '<PropertyPath>STATUS</PropertyPath>' ) ).
  ENDMETHOD.

  METHOD entity_set_with_filter.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( '/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"type":"ZSTG_SADL_SRV.Zc_Stg_Travel"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TRAVELID":"T0001","DESCRIPTION":"Berlin to Copenhagen","STATUS":"A","SEATS":2' ) ).

    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet'
                       iv_query = `$filter=STATUS%20eq%20'A'%20and%20SEATS%20ge%202&$orderby=TRAVELID%20desc&$top=1&$inlinecount=allpages` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"TRAVELID":"T0009"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"TRAVELID":"T0001"' ) ).

    ls_response = get( '/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet/$count' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-body
                                        exp = '4' ).
  ENDMETHOD.

  METHOD entity_by_key_and_navigation.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( `/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet('T0002')` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"DESCRIPTION":"Copenhagen to Aarhus"' ) ).

    ls_response = get( `/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet('T0001')/TO_BOOKINGS` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"BOOKINGID":"B001","CUSTOMER":"Ada Lovelace"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"BOOKINGID":"B002"' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS 'Dijkstra' ) ).

    ls_response = get( `/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_BookingSet(TRAVELID='T0002',BOOKINGID='B001')/TO_TRAVEL` ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"DESCRIPTION":"Copenhagen to Aarhus"' ) ).
  ENDMETHOD.

  METHOD expand.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelSet'
                       iv_query = '$expand=TO_BOOKINGS&$top=1' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"SEATS":2,"TO_BOOKINGS":{"results":[{"__metadata"' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"CUSTOMER":"Grace Hopper"' ) ).
  ENDMETHOD.

  METHOD analytics_group_by.
    DATA ls_response TYPE zcl_stg_dispatcher=>ty_response.

* an aggregate entity with $select: dimensions group, measures sum
    ls_response = get( iv_path  = '/sap/opu/odata/sap/ZSTG_SADL_SRV/Zc_Stg_TravelcubeSet'
                       iv_query = '$select=STATUS,SEATS&$orderby=STATUS' ).
    cl_abap_unit_assert=>assert_equals( act = ls_response-status
                                        exp = 200 ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"STATUS":"A","SEATS":12' ) ).
    cl_abap_unit_assert=>assert_true( boolc( ls_response-body CS '"STATUS":"X","SEATS":4' ) ).
    cl_abap_unit_assert=>assert_false( boolc( ls_response-body CS '"TRAVELID":"T0001"' ) ).
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_luw DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
* The ABAP LUW on whichever database is behind the runtime: a failed
* statement must not lose the successful ones before it, ROLLBACK WORK
* must undo them, COMMIT WORK must keep them.
  PRIVATE SECTION.
    METHODS rollback_work_undoes FOR TESTING RAISING cx_static_check.
    METHODS failure_keeps_the_luw FOR TESTING RAISING cx_static_check.

    METHODS count_travels
      RETURNING
        VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS ltcl_luw IMPLEMENTATION.

  METHOD count_travels.
    SELECT COUNT( * ) FROM zstg_demo INTO rv_count.
  ENDMETHOD.

  METHOD rollback_work_undoes.
    DATA ls_row   TYPE zstg_demo.
    DATA lv_before TYPE i.

    lv_before = count_travels( ).
    ls_row-mandt = sy-mandt.
    ls_row-travel_id = 'T0900'.
    ls_row-description = 'rolled back'.
    INSERT zstg_demo FROM ls_row.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = count_travels( )
                                        exp = lv_before + 1 ).
    ROLLBACK WORK.
    cl_abap_unit_assert=>assert_equals( act = count_travels( )
                                        exp = lv_before ).
  ENDMETHOD.

  METHOD failure_keeps_the_luw.
    DATA ls_row    TYPE zstg_demo.
    DATA lv_before TYPE i.

    lv_before = count_travels( ).
    ls_row-mandt = sy-mandt.
    ls_row-travel_id = 'T0901'.
    ls_row-description = 'kept'.
    INSERT zstg_demo FROM ls_row.
    cl_abap_unit_assert=>assert_subrc( ).

* duplicate key: subrc 4, the LUW must survive
    INSERT zstg_demo FROM ls_row.
    cl_abap_unit_assert=>assert_equals( act = sy-subrc
                                        exp = 4 ).
    cl_abap_unit_assert=>assert_equals( act = count_travels( )
                                        exp = lv_before + 1 ).

    COMMIT WORK.
    cl_abap_unit_assert=>assert_equals( act = count_travels( )
                                        exp = lv_before + 1 ).

    DELETE FROM zstg_demo WHERE travel_id = 'T0901'.
    COMMIT WORK.
    cl_abap_unit_assert=>assert_equals( act = count_travels( )
                                        exp = lv_before ).
  ENDMETHOD.

ENDCLASS.
