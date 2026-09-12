* the demo's search help, served from its DDIC definition through the
* generated registry, the way a SEGW value help reaches it
CLASS ltcl_shlp DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS setup.
    METHODS all_statuses_sorted FOR TESTING RAISING cx_static_check.
    METHODS filtered_by_status FOR TESTING RAISING cx_static_check.
    METHODS value_help_entity_set FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_shlp IMPLEMENTATION.

  METHOD setup.
    zcl_oao_shlp_data=>clear( ).
    zcl_stg_shlp_registry=>register( ).
  ENDMETHOD.

  METHOD all_statuses_sorted.
    DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.
    DATA lt_selopt  TYPE ddshselops.
    DATA lt_result  TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.
    DATA ls_result  LIKE LINE OF lt_result.
    DATA ls_message TYPE bapiret2.

    lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).
    lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
      EXPORTING
        iv_shlp_name   = 'ZSTG_STATUS_SH'
        iv_sort        = abap_true
        it_selopt      = lt_selopt
      IMPORTING
        et_return_list = lt_result
        es_message     = ls_message ).
    cl_abap_unit_assert=>assert_initial( ls_message ).
* three statuses, two fields each, A before O before X
    cl_abap_unit_assert=>assert_equals( act = lines( lt_result )
                                        exp = 6 ).
    READ TABLE lt_result INDEX 1 INTO ls_result.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-field_value
                                        exp = 'A' ).
    READ TABLE lt_result INDEX 6 INTO ls_result.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-field_name
                                        exp = 'STATUS_TEXT' ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-field_value
                                        exp = 'Cancelled' ).
  ENDMETHOD.

  METHOD filtered_by_status.
    DATA lo_sh_data TYPE REF TO /iwbep/if_sb_shlp_data.
    DATA lt_selopt  TYPE ddshselops.
    DATA ls_selopt  LIKE LINE OF lt_selopt.
    DATA lt_result  TYPE /iwbep/if_sb_gendpc_shlp_data=>tt_result_list.
    DATA ls_result  LIKE LINE OF lt_result.
    DATA ls_message TYPE bapiret2.

    ls_selopt-shlpname  = 'ZSTG_STATUS_SH'.
    ls_selopt-shlpfield = 'STATUS'.
    ls_selopt-sign      = 'I'.
    ls_selopt-option    = 'EQ'.
    ls_selopt-low       = 'X'.
    APPEND ls_selopt TO lt_selopt.
    lo_sh_data = /iwbep/cl_sb_shlp_data_factory=>get_sh_data_obj( ).
    lo_sh_data->/iwbep/if_sb_gendpc_shlp_data~get_search_help_values(
      EXPORTING
        iv_shlp_name   = 'ZSTG_STATUS_SH'
        it_selopt      = lt_selopt
      IMPORTING
        et_return_list = lt_result
        es_message     = ls_message ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_result )
                                        exp = 2 ).
    READ TABLE lt_result INDEX 2 INTO ls_result.
    cl_abap_unit_assert=>assert_subrc( ).
    cl_abap_unit_assert=>assert_equals( act = ls_result-field_value
                                        exp = 'Cancelled' ).
  ENDMETHOD.

  METHOD value_help_entity_set.
* the DPC's StatusVHSet goes through the search help: $filter on Status,
* the dialog's search on the text
    DATA lo_dpc      TYPE REF TO zcl_zstg_demo_dpc_ext.
    DATA lo_runtime  TYPE REF TO /iwbep/if_mgw_appl_srv_runtime.
    DATA lo_context  TYPE REF TO zcl_oao_request_context.
    DATA lt_filter   TYPE /iwbep/t_mgw_select_option.
    DATA ls_filter   TYPE /iwbep/s_mgw_select_option.
    DATA ls_range    TYPE /iwbep/s_cod_select_option.
    DATA ls_paging   TYPE /iwbep/s_mgw_paging.
    DATA lt_keys     TYPE /iwbep/t_mgw_name_value_pair.
    DATA lt_nav      TYPE /iwbep/t_mgw_navigation_path.
    DATA lt_order    TYPE /iwbep/t_mgw_sorting_order.
    DATA lr_data     TYPE REF TO data.
    FIELD-SYMBOLS <lt_rows> TYPE zcl_zstg_demo_mpc=>tt_status_vh.

    CREATE OBJECT lo_dpc.
    lo_runtime = lo_dpc.
    CREATE OBJECT lo_context
      EXPORTING
        iv_entity_set_name = 'StatusVHSet'.
    ls_filter-property = 'Status'.
    ls_range-sign   = 'I'.
    ls_range-option = 'EQ'.
    ls_range-low    = 'A'.
    APPEND ls_range TO ls_filter-select_options.
    APPEND ls_filter TO lt_filter.

    lo_runtime->get_entityset(
      EXPORTING
        iv_entity_name           = 'StatusVH'
        iv_entity_set_name       = 'StatusVHSet'
        iv_source_name           = ''
        it_filter_select_options = lt_filter
        is_paging                = ls_paging
        it_key_tab               = lt_keys
        it_navigation_path       = lt_nav
        it_order                 = lt_order
        iv_filter_string         = ''
        iv_search_string         = ''
        io_tech_request_context  = lo_context
      IMPORTING
        er_entityset             = lr_data ).
    ASSIGN lr_data->* TO <lt_rows>.
    cl_abap_unit_assert=>assert_equals( act = lines( <lt_rows> )
                                        exp = 1 ).
  ENDMETHOD.

ENDCLASS.
