CLASS zcl_zstg_sadl_dpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_data ABSTRACT CREATE PUBLIC.
* A reference-data-source DPC in the shape SEGW generates: every operation
* is delegated to the SADL data provider obtained from the factory.
  PUBLIC SECTION.
    INTERFACES if_sadl_gw_dpc_util.

    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entityset REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_expanded_entityset REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_expanded_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action REDEFINITION.
  PROTECTED SECTION.
    DATA mo_sadl_dpc TYPE REF TO if_sadl_gw_dpc.

    METHODS zc_stg_travel_get_entityset
      IMPORTING
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entityset
      EXPORTING
        et_entityset            TYPE STANDARD TABLE
        es_response_context     TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_context
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zstg_sadl_dpc IMPLEMENTATION.

  METHOD if_sadl_gw_dpc_util~get_dpc.
    DATA lv_sadl_xml TYPE string.

    IF mo_sadl_dpc IS BOUND.
      ro_dpc = mo_sadl_dpc.
      RETURN.
    ENDIF.

    lv_sadl_xml =
      |<?xml version="1.0" encoding="utf-16"?>| &&
      |<sadl:definition xmlns:sadl="http://sap.com/sap.nw.f.sadl" syntaxVersion="" >| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_TRAVEL" binding="ZC_STG_TRAVEL" />| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_BOOKING" binding="ZC_STG_BOOKING" />| &&
      | <sadl:dataSource type="CDS" name="ZC_STG_TRAVELCUBE" binding="ZC_STG_TRAVELCUBE" />| &&
      |<sadl:resultSet>| &&
      |<sadl:structure name="Zc_Stg_Travel" dataSource="ZC_STG_TRAVEL" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      | <sadl:association name="TO_BOOKINGS" binding="_BOOKINGS" target="Zc_Stg_Booking" cardinality="many" />| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Stg_Booking" dataSource="ZC_STG_BOOKING" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      | <sadl:association name="TO_TRAVEL" binding="_TRAVEL" target="Zc_Stg_Travel" cardinality="zeroToOne" />| &&
      |</sadl:structure>| &&
      |<sadl:structure name="Zc_Stg_Travelcube" dataSource="ZC_STG_TRAVELCUBE" maxEditMode="RO" exposure="TRUE" >| &&
      | <sadl:query name="SADL_QUERY" >| &&
      | </sadl:query>| &&
      |</sadl:structure>| &&
      |</sadl:resultSet>| &&
      |</sadl:definition>|.

    mo_sadl_dpc = cl_sadl_gw_dpc_factory=>create_for_sadl( iv_sadl_xml  = lv_sadl_xml
                                                           iv_timestamp = '20260912010000'
                                                           iv_uuid      = 'ZSTG_SADL'
                                                           io_context   = me->mo_context ).
    ro_dpc = mo_sadl_dpc.
  ENDMETHOD.

  METHOD zc_stg_travel_get_entityset.
    if_sadl_gw_dpc_util~get_dpc( )->get_entityset( EXPORTING io_tech_request_context = io_tech_request_context
                                                   IMPORTING et_data                 = et_entityset
                                                             es_response_context     = es_response_context ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.
    DATA lt_travel  TYPE STANDARD TABLE OF zvstgtravel WITH DEFAULT KEY.
    DATA lt_booking TYPE STANDARD TABLE OF zvstgbooking WITH DEFAULT KEY.
    DATA lt_cube    TYPE STANDARD TABLE OF zvstgtravelcube WITH DEFAULT KEY.
    DATA lv_entityset_name TYPE string.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'Zc_Stg_TravelSet'.
        zc_stg_travel_get_entityset( EXPORTING io_tech_request_context = io_tech_request_context
                                     IMPORTING et_entityset            = lt_travel
                                               es_response_context     = es_response_context ).
        copy_data_to_ref( EXPORTING is_data = lt_travel
                          CHANGING  cr_data = er_entityset ).
      WHEN 'Zc_Stg_BookingSet'.
        if_sadl_gw_dpc_util~get_dpc( )->get_entityset( EXPORTING io_tech_request_context = io_tech_request_context
                                                       IMPORTING et_data                 = lt_booking
                                                                 es_response_context     = es_response_context ).
        copy_data_to_ref( EXPORTING is_data = lt_booking
                          CHANGING  cr_data = er_entityset ).
      WHEN 'Zc_Stg_TravelcubeSet'.
        if_sadl_gw_dpc_util~get_dpc( )->get_entityset( EXPORTING io_tech_request_context = io_tech_request_context
                                                       IMPORTING et_data                 = lt_cube
                                                                 es_response_context     = es_response_context ).
        copy_data_to_ref( EXPORTING is_data = lt_cube
                          CHANGING  cr_data = er_entityset ).
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~get_entityset(
          EXPORTING
            iv_entity_name           = iv_entity_name
            iv_entity_set_name       = iv_entity_set_name
            iv_source_name           = iv_source_name
            it_filter_select_options = it_filter_select_options
            it_order                 = it_order
            is_paging                = is_paging
            it_navigation_path       = it_navigation_path
            it_key_tab               = it_key_tab
            iv_filter_string         = iv_filter_string
            iv_search_string         = iv_search_string
            io_tech_request_context  = io_tech_request_context
          IMPORTING
            er_entityset             = er_entityset ).
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entity.
    DATA ls_travel  TYPE zvstgtravel.
    DATA ls_booking TYPE zvstgbooking.
    DATA lv_entityset_name TYPE string.
    DATA lr_entity  TYPE REF TO data.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'Zc_Stg_TravelSet'.
        if_sadl_gw_dpc_util~get_dpc( )->get_entity( EXPORTING io_tech_request_context = io_tech_request_context
                                                    IMPORTING es_data                 = ls_travel ).
        IF ls_travel IS NOT INITIAL.
          copy_data_to_ref( EXPORTING is_data = ls_travel
                            CHANGING  cr_data = er_entity ).
        ELSE.
          er_entity = lr_entity.
        ENDIF.
      WHEN 'Zc_Stg_BookingSet'.
        if_sadl_gw_dpc_util~get_dpc( )->get_entity( EXPORTING io_tech_request_context = io_tech_request_context
                                                    IMPORTING es_data                 = ls_booking ).
        IF ls_booking IS NOT INITIAL.
          copy_data_to_ref( EXPORTING is_data = ls_booking
                            CHANGING  cr_data = er_entity ).
        ELSE.
          er_entity = lr_entity.
        ENDIF.
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~get_entity(
          EXPORTING
            iv_entity_name     = iv_entity_name
            iv_entity_set_name = iv_entity_set_name
            iv_source_name     = iv_source_name
            it_key_tab         = it_key_tab
            it_navigation_path = it_navigation_path
          IMPORTING
            er_entity          = er_entity ).
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_expanded_entityset.
    DATA lv_mapped TYPE abap_bool.

    if_sadl_gw_dpc_util~get_dpc( )->get_expanded_entityset( EXPORTING io_expand_node           = io_expand
                                                                      io_tech_request_context  = io_tech_request_context
                                                            IMPORTING er_entityset             = er_entityset
                                                                      et_expanded_tech_clauses = et_expanded_tech_clauses
                                                                      es_response_context      = es_response_context
                                                                      ev_entity_mapped_by_sadl = lv_mapped ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_expanded_entity.
    DATA lv_mapped TYPE abap_bool.

    if_sadl_gw_dpc_util~get_dpc( )->get_expanded_entity( EXPORTING io_expand_node           = io_expand
                                                                   io_tech_request_context  = io_tech_request_context
                                                         IMPORTING er_entity                = er_entity
                                                                   et_expanded_tech_clauses = et_expanded_tech_clauses
                                                                   es_response_context      = es_response_context
                                                                   ev_entity_mapped_by_sadl = lv_mapped ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    if_sadl_gw_dpc_util~get_dpc( )->execute_action( EXPORTING io_tech_request_context = io_tech_request_context
                                                    IMPORTING er_data                 = er_data ).
  ENDMETHOD.

ENDCLASS.
