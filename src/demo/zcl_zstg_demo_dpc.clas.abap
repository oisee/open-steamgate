CLASS zcl_zstg_demo_dpc DEFINITION PUBLIC INHERITING FROM /iwbep/cl_mgw_push_abs_data ABSTRACT CREATE PUBLIC.
* Hand-written in the shape SEGW generates for the DPC base class:
* dispatch on the entity-set name, delegate to <set>_get_entityset etc.,
* copy the typed result into the untyped reference. Clean-room.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_sb_gendpc_shlp_data.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entityset REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~get_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~create_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~update_entity REDEFINITION.
    METHODS /iwbep/if_mgw_appl_srv_runtime~delete_entity REDEFINITION.
  PROTECTED SECTION.
    METHODS statusvhset_get_entityset
      IMPORTING
        iv_entity_name           TYPE string
        iv_entity_set_name       TYPE string
        iv_source_name           TYPE string
        it_filter_select_options TYPE /iwbep/t_mgw_select_option
        is_paging                TYPE /iwbep/s_mgw_paging
        it_key_tab               TYPE /iwbep/t_mgw_name_value_pair
        it_navigation_path       TYPE /iwbep/t_mgw_navigation_path
        it_order                 TYPE /iwbep/t_mgw_sorting_order
        iv_filter_string         TYPE string
        iv_search_string         TYPE string
        io_tech_request_context  TYPE REF TO /iwbep/if_mgw_req_entityset OPTIONAL
      EXPORTING
        et_entityset             TYPE zcl_zstg_demo_mpc=>tt_status_vh
        es_response_context      TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_context
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS bookingset_get_entityset
      IMPORTING
        iv_entity_name           TYPE string
        iv_entity_set_name       TYPE string
        iv_source_name           TYPE string
        it_filter_select_options TYPE /iwbep/t_mgw_select_option
        is_paging                TYPE /iwbep/s_mgw_paging
        it_key_tab               TYPE /iwbep/t_mgw_name_value_pair
        it_navigation_path       TYPE /iwbep/t_mgw_navigation_path
        it_order                 TYPE /iwbep/t_mgw_sorting_order
        iv_filter_string         TYPE string
        iv_search_string         TYPE string
        io_tech_request_context  TYPE REF TO /iwbep/if_mgw_req_entityset OPTIONAL
      EXPORTING
        et_entityset             TYPE zcl_zstg_demo_mpc=>tt_booking
        es_response_context      TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_context
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS bookingset_get_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_request_object       TYPE REF TO /iwbep/if_mgw_req_entity OPTIONAL
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_booking
        es_response_context     TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_entity_cntxt
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS travelset_create_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_c OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
        io_data_provider        TYPE REF TO /iwbep/if_mgw_entry_provider OPTIONAL
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_travel
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS travelset_update_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_u OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
        io_data_provider        TYPE REF TO /iwbep/if_mgw_entry_provider OPTIONAL
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_travel
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS travelset_delete_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_d OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS bookingset_create_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_c OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
        io_data_provider        TYPE REF TO /iwbep/if_mgw_entry_provider OPTIONAL
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_booking
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS bookingset_update_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_u OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
        io_data_provider        TYPE REF TO /iwbep/if_mgw_entry_provider OPTIONAL
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_booking
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS bookingset_delete_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity_d OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS travelset_get_entityset
      IMPORTING
        iv_entity_name           TYPE string
        iv_entity_set_name       TYPE string
        iv_source_name           TYPE string
        it_filter_select_options TYPE /iwbep/t_mgw_select_option
        is_paging                TYPE /iwbep/s_mgw_paging
        it_key_tab               TYPE /iwbep/t_mgw_name_value_pair
        it_navigation_path       TYPE /iwbep/t_mgw_navigation_path
        it_order                 TYPE /iwbep/t_mgw_sorting_order
        iv_filter_string         TYPE string
        iv_search_string         TYPE string
        io_tech_request_context  TYPE REF TO /iwbep/if_mgw_req_entityset OPTIONAL
      EXPORTING
        et_entityset             TYPE zcl_zstg_demo_mpc=>tt_travel
        es_response_context      TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_context
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.

    METHODS travelset_get_entity
      IMPORTING
        iv_entity_name          TYPE string
        iv_entity_set_name      TYPE string
        iv_source_name          TYPE string
        it_key_tab              TYPE /iwbep/t_mgw_name_value_pair
        io_request_object       TYPE REF TO /iwbep/if_mgw_req_entity OPTIONAL
        io_tech_request_context TYPE REF TO /iwbep/if_mgw_req_entity OPTIONAL
        it_navigation_path      TYPE /iwbep/t_mgw_navigation_path
      EXPORTING
        er_entity               TYPE zcl_zstg_demo_mpc=>ts_travel
        es_response_context     TYPE /iwbep/if_mgw_appl_srv_runtime=>ty_s_mgw_response_entity_cntxt
      RAISING
        /iwbep/cx_mgw_busi_exception
        /iwbep/cx_mgw_tech_exception.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zstg_demo_dpc IMPLEMENTATION.

  METHOD /iwbep/if_mgw_appl_srv_runtime~get_entityset.
    DATA lt_travel         TYPE zcl_zstg_demo_mpc=>tt_travel.
    DATA lt_booking        TYPE zcl_zstg_demo_mpc=>tt_booking.
    DATA lt_status_vh      TYPE zcl_zstg_demo_mpc=>tt_status_vh.
    DATA lv_entityset_name TYPE string.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'StatusVHSet'.
        statusvhset_get_entityset(
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
            et_entityset             = lt_status_vh
            es_response_context      = es_response_context ).
        copy_data_to_ref(
          EXPORTING
            is_data = lt_status_vh
          CHANGING
            cr_data = er_entityset ).
      WHEN 'BookingSet'.
        bookingset_get_entityset(
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
            et_entityset             = lt_booking
            es_response_context      = es_response_context ).
        copy_data_to_ref(
          EXPORTING
            is_data = lt_booking
          CHANGING
            cr_data = er_entityset ).
      WHEN 'TravelSet'.
        travelset_get_entityset(
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
            et_entityset             = lt_travel
            es_response_context      = es_response_context ).
        copy_data_to_ref(
          EXPORTING
            is_data = lt_travel
          CHANGING
            cr_data = er_entityset ).
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
    DATA ls_travel         TYPE zcl_zstg_demo_mpc=>ts_travel.
    DATA ls_booking        TYPE zcl_zstg_demo_mpc=>ts_booking.
    DATA lv_entityset_name TYPE string.
    DATA lr_entity         TYPE REF TO data.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'BookingSet'.
        bookingset_get_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_booking
            es_response_context     = es_response_context ).
        IF ls_booking IS NOT INITIAL.
          copy_data_to_ref(
            EXPORTING
              is_data = ls_booking
            CHANGING
              cr_data = er_entity ).
        ELSE.
          er_entity = lr_entity.
        ENDIF.
      WHEN 'TravelSet'.
        travelset_get_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_travel
            es_response_context     = es_response_context ).
        IF ls_travel IS NOT INITIAL.
          copy_data_to_ref(
            EXPORTING
              is_data = ls_travel
            CHANGING
              cr_data = er_entity ).
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

  METHOD /iwbep/if_mgw_appl_srv_runtime~create_entity.
    DATA ls_travel         TYPE zcl_zstg_demo_mpc=>ts_travel.
    DATA ls_booking        TYPE zcl_zstg_demo_mpc=>ts_booking.
    DATA lv_entityset_name TYPE string.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'TravelSet'.
        travelset_create_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            io_data_provider        = io_data_provider
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_travel ).
        copy_data_to_ref(
          EXPORTING
            is_data = ls_travel
          CHANGING
            cr_data = er_entity ).
      WHEN 'BookingSet'.
        bookingset_create_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            io_data_provider        = io_data_provider
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_booking ).
        copy_data_to_ref(
          EXPORTING
            is_data = ls_booking
          CHANGING
            cr_data = er_entity ).
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~create_entity(
          EXPORTING
            iv_entity_name     = iv_entity_name
            iv_entity_set_name = iv_entity_set_name
            iv_source_name     = iv_source_name
            io_data_provider   = io_data_provider
            it_key_tab         = it_key_tab
            it_navigation_path = it_navigation_path
          IMPORTING
            er_entity          = er_entity ).
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~update_entity.
    DATA ls_travel         TYPE zcl_zstg_demo_mpc=>ts_travel.
    DATA ls_booking        TYPE zcl_zstg_demo_mpc=>ts_booking.
    DATA lv_entityset_name TYPE string.
    DATA lr_entity         TYPE REF TO data.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'TravelSet'.
        travelset_update_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            io_data_provider        = io_data_provider
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_travel ).
        IF ls_travel IS NOT INITIAL.
          copy_data_to_ref(
            EXPORTING
              is_data = ls_travel
            CHANGING
              cr_data = er_entity ).
        ELSE.
          er_entity = lr_entity.
        ENDIF.
      WHEN 'BookingSet'.
        bookingset_update_entity(
          EXPORTING
            iv_entity_name          = iv_entity_name
            iv_entity_set_name      = iv_entity_set_name
            iv_source_name          = iv_source_name
            io_data_provider        = io_data_provider
            it_key_tab              = it_key_tab
            it_navigation_path      = it_navigation_path
            io_tech_request_context = io_tech_request_context
          IMPORTING
            er_entity               = ls_booking ).
        IF ls_booking IS NOT INITIAL.
          copy_data_to_ref(
            EXPORTING
              is_data = ls_booking
            CHANGING
              cr_data = er_entity ).
        ELSE.
          er_entity = lr_entity.
        ENDIF.
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~update_entity(
          EXPORTING
            iv_entity_name     = iv_entity_name
            iv_entity_set_name = iv_entity_set_name
            iv_source_name     = iv_source_name
            io_data_provider   = io_data_provider
            it_key_tab         = it_key_tab
            it_navigation_path = it_navigation_path
          IMPORTING
            er_entity          = er_entity ).
    ENDCASE.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_appl_srv_runtime~delete_entity.
    DATA lv_entityset_name TYPE string.

    lv_entityset_name = io_tech_request_context->get_entity_set_name( ).

    CASE lv_entityset_name.
      WHEN 'TravelSet'.
        travelset_delete_entity(
          iv_entity_name          = iv_entity_name
          iv_entity_set_name      = iv_entity_set_name
          iv_source_name          = iv_source_name
          it_key_tab              = it_key_tab
          it_navigation_path      = it_navigation_path
          io_tech_request_context = io_tech_request_context ).
      WHEN 'BookingSet'.
        bookingset_delete_entity(
          iv_entity_name          = iv_entity_name
          iv_entity_set_name      = iv_entity_set_name
          iv_source_name          = iv_source_name
          it_key_tab              = it_key_tab
          it_navigation_path      = it_navigation_path
          io_tech_request_context = io_tech_request_context ).
      WHEN OTHERS.
        super->/iwbep/if_mgw_appl_srv_runtime~delete_entity(
          iv_entity_name     = iv_entity_name
          iv_entity_set_name = iv_entity_set_name
          iv_source_name     = iv_source_name
          it_key_tab         = it_key_tab
          it_navigation_path = it_navigation_path ).
    ENDCASE.
  ENDMETHOD.

  METHOD statusvhset_get_entityset.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'STATUSVHSET_GET_ENTITYSET'.
  ENDMETHOD.

  METHOD bookingset_get_entityset.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'BOOKINGSET_GET_ENTITYSET'.
  ENDMETHOD.

  METHOD bookingset_get_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'BOOKINGSET_GET_ENTITY'.
  ENDMETHOD.

  METHOD bookingset_create_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'BOOKINGSET_CREATE_ENTITY'.
  ENDMETHOD.

  METHOD bookingset_update_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'BOOKINGSET_UPDATE_ENTITY'.
  ENDMETHOD.

  METHOD bookingset_delete_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'BOOKINGSET_DELETE_ENTITY'.
  ENDMETHOD.

  METHOD travelset_create_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'TRAVELSET_CREATE_ENTITY'.
  ENDMETHOD.

  METHOD travelset_update_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'TRAVELSET_UPDATE_ENTITY'.
  ENDMETHOD.

  METHOD travelset_delete_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'TRAVELSET_DELETE_ENTITY'.
  ENDMETHOD.

  METHOD travelset_get_entityset.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'TRAVELSET_GET_ENTITYSET'.
  ENDMETHOD.

  METHOD travelset_get_entity.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_not_impl_exc
      EXPORTING
        textid = /iwbep/cx_mgw_not_impl_exc=>method_not_implemented
        method = 'TRAVELSET_GET_ENTITY'.
  ENDMETHOD.

  METHOD /iwbep/if_sb_gendpc_shlp_data~get_search_help_values.
* Call to Search Help run time mechanism to get values
    DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.

    CLEAR: et_return_list, es_message.
    lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).

    lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
      EXPORTING
        iv_shlp_name      = iv_shlp_name
        iv_maxrows        = iv_maxrows
        iv_sort           = iv_sort
        iv_call_shlt_exit = iv_call_shlt_exit
        it_selopt         = it_selopt
      IMPORTING
        et_return_list    = et_return_list
        es_message        = es_message ).
  ENDMETHOD.

ENDCLASS.
