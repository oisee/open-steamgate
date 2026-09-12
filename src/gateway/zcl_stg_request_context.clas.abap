CLASS zcl_stg_request_context DEFINITION PUBLIC CREATE PUBLIC.
* The io_tech_request_context a DPC receives: one object serving every
* /iwbep/if_mgw_req_* facet plus the filter facet. Filled by the dispatcher.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_mgw_req_entityset.
    INTERFACES /iwbep/if_mgw_req_entity.
    INTERFACES /iwbep/if_mgw_req_entity_c.
    INTERFACES /iwbep/if_mgw_req_entity_d.
    INTERFACES /iwbep/if_mgw_req_entity_u.
    INTERFACES /iwbep/if_mgw_req_filter.
    INTERFACES /iwbep/if_mgw_req_func_import.

    DATA mv_entity_set    TYPE string.
    DATA mv_entity_type   TYPE string.
    DATA mv_top           TYPE string.
    DATA mv_skip          TYPE i.
    DATA mv_inlinecount   TYPE abap_bool.
    DATA mv_count         TYPE abap_bool.
    DATA mt_orderby       TYPE /iwbep/t_mgw_tech_order.
    DATA mt_filter        TYPE /iwbep/t_mgw_select_option.
    DATA mv_filter_string TYPE string.
    DATA mt_key_tab       TYPE /iwbep/t_mgw_name_value_pair.
    DATA ms_set           TYPE zcl_stg_model_info=>ty_entity_set.
    DATA mt_navigation_path TYPE /iwbep/t_mgw_navigation_path.
    DATA mv_source_entity_set TYPE string.
    DATA mv_select        TYPE string.
    DATA mv_aggregate     TYPE abap_bool.

    METHODS get_sorting_order
      RETURNING
        VALUE(rt_order) TYPE /iwbep/t_mgw_sorting_order.

    METHODS get_paging
      RETURNING
        VALUE(rs_paging) TYPE /iwbep/s_mgw_paging.
  PRIVATE SECTION.
    METHODS keys_to_structure
      EXPORTING
        es_key_values TYPE data.

    METHODS where_for_option
      IMPORTING
        iv_field         TYPE string
        is_option        TYPE /iwbep/s_cod_select_option
      RETURNING
        VALUE(rv_clause) TYPE string.

    METHODS sql_literal
      IMPORTING
        iv_value         TYPE string
      RETURNING
        VALUE(rv_literal) TYPE string.
ENDCLASS.

CLASS zcl_stg_request_context IMPLEMENTATION.

  METHOD get_sorting_order.
    DATA ls_tech LIKE LINE OF mt_orderby.
    DATA ls_sort TYPE /iwbep/s_mgw_sorting_order.

    LOOP AT mt_orderby INTO ls_tech.
      ls_sort-property = ls_tech-property.
      ls_sort-order    = ls_tech-order.
      APPEND ls_sort TO rt_order.
    ENDLOOP.
  ENDMETHOD.

  METHOD get_paging.
    IF mv_top IS NOT INITIAL.
      rs_paging-top = mv_top.
    ENDIF.
    rs_paging-skip = mv_skip.
  ENDMETHOD.

  METHOD keys_to_structure.
    DATA ls_key      LIKE LINE OF mt_key_tab.
    DATA ls_property TYPE zcl_stg_model_info=>ty_property.
    FIELD-SYMBOLS <lv_target> TYPE any.

    CLEAR es_key_values.
    LOOP AT mt_key_tab INTO ls_key.
      READ TABLE ms_set-properties INTO ls_property WITH KEY name = ls_key-name.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      ASSIGN COMPONENT ls_property-fieldname OF STRUCTURE es_key_values TO <lv_target>.
      IF sy-subrc = 0.
        <lv_target> = ls_key-value.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD sql_literal.
    DATA lv_quote TYPE string.
    DATA lv_two   TYPE string.

    lv_quote   = |'|.
    lv_two     = ''''''.
    rv_literal = iv_value.
    REPLACE ALL OCCURRENCES OF lv_quote IN rv_literal WITH lv_two.
    rv_literal = |'{ rv_literal }'|.
  ENDMETHOD.

  METHOD where_for_option.
    DATA lv_pattern TYPE string.

    CASE is_option-option.
      WHEN 'EQ'.
        rv_clause = |{ iv_field } = { sql_literal( is_option-low ) }|.
      WHEN 'NE'.
        rv_clause = |{ iv_field } <> { sql_literal( is_option-low ) }|.
      WHEN 'GT'.
        rv_clause = |{ iv_field } > { sql_literal( is_option-low ) }|.
      WHEN 'GE'.
        rv_clause = |{ iv_field } >= { sql_literal( is_option-low ) }|.
      WHEN 'LT'.
        rv_clause = |{ iv_field } < { sql_literal( is_option-low ) }|.
      WHEN 'LE'.
        rv_clause = |{ iv_field } <= { sql_literal( is_option-low ) }|.
      WHEN 'BT'.
        rv_clause = |{ iv_field } BETWEEN { sql_literal( is_option-low ) } AND { sql_literal( is_option-high ) }|.
      WHEN 'CP'.
        lv_pattern = is_option-low.
        REPLACE ALL OCCURRENCES OF '*' IN lv_pattern WITH '%'.
        REPLACE ALL OCCURRENCES OF '+' IN lv_pattern WITH '_'.
        rv_clause = |{ iv_field } LIKE { sql_literal( lv_pattern ) }|.
      WHEN OTHERS.
        rv_clause = |{ iv_field } = { sql_literal( is_option-low ) }|.
    ENDCASE.
    IF is_option-sign = 'E'.
      rv_clause = |NOT ( { rv_clause } )|.
    ENDIF.
  ENDMETHOD.

* ---------------- entity set facet

  METHOD /iwbep/if_mgw_req_entityset~get_entity_set_name.
    rv_entity_set = mv_entity_set.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_top.
    rv_top = mv_top.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_skip.
    rv_skip = mv_skip.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~has_inlinecount.
    rv_has_inlinecount = mv_inlinecount.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~has_count.
    rv_has_count = mv_count.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_orderby.
    rt_orderby = mt_orderby.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_filter.
    ro_filter = me.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_converted_source_keys.
    keys_to_structure( IMPORTING es_key_values = es_key_values ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_osql_where_clause.
    DATA ls_filter   LIKE LINE OF mt_filter.
    DATA ls_option   LIKE LINE OF ls_filter-select_options.
    DATA ls_property TYPE zcl_stg_model_info=>ty_property.
    DATA lv_field    TYPE string.
    DATA lv_group    TYPE string.
    DATA lv_clause   TYPE string.

    LOOP AT mt_filter INTO ls_filter.
      READ TABLE ms_set-properties INTO ls_property WITH KEY name = ls_filter-property.
      IF sy-subrc = 0.
        lv_field = ls_property-fieldname.
      ELSE.
        lv_field = to_upper( ls_filter-property ).
      ENDIF.
      CLEAR lv_group.
      LOOP AT ls_filter-select_options INTO ls_option.
        lv_clause = where_for_option( iv_field  = lv_field
                                      is_option = ls_option ).
        IF lv_group IS INITIAL.
          lv_group = lv_clause.
        ELSEIF ls_option-sign = 'E'.
          lv_group = |{ lv_group } AND { lv_clause }|.
        ELSE.
          lv_group = |{ lv_group } OR { lv_clause }|.
        ENDIF.
      ENDLOOP.
      IF lv_group IS INITIAL.
        CONTINUE.
      ENDIF.
      IF rv_osql_where_clause IS INITIAL.
        rv_osql_where_clause = |( { lv_group } )|.
      ELSE.
        rv_osql_where_clause = |{ rv_osql_where_clause } AND ( { lv_group } )|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entityset~get_osql_where_clause_convert.
    rv_osql_where_clause = /iwbep/if_mgw_req_entityset~get_osql_where_clause( ).
  ENDMETHOD.

* ---------------- filter facet

  METHOD /iwbep/if_mgw_req_filter~get_filter_select_options.
    rt_filter_select_options = mt_filter.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_filter~get_filter_string.
    rv_filter_string = mv_filter_string.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_filter~convert_select_option.
    DATA ls_option TYPE /iwbep/s_cod_select_option.
    DATA lr_line   TYPE REF TO data.
    FIELD-SYMBOLS <ls_line> TYPE any.
    FIELD-SYMBOLS <lv_comp> TYPE any.

    CLEAR et_select_option.
    ev_no_matching_values_found = abap_false.
    CREATE DATA lr_line LIKE LINE OF et_select_option.
    ASSIGN lr_line->* TO <ls_line>.

    LOOP AT is_select_option-select_options INTO ls_option.
      CLEAR <ls_line>.
      ASSIGN COMPONENT 'SIGN' OF STRUCTURE <ls_line> TO <lv_comp>.
      IF sy-subrc = 0.
        <lv_comp> = ls_option-sign.
      ENDIF.
      ASSIGN COMPONENT 'OPTION' OF STRUCTURE <ls_line> TO <lv_comp>.
      IF sy-subrc = 0.
        <lv_comp> = ls_option-option.
      ENDIF.
      ASSIGN COMPONENT 'LOW' OF STRUCTURE <ls_line> TO <lv_comp>.
      IF sy-subrc = 0.
        <lv_comp> = ls_option-low.
      ENDIF.
      ASSIGN COMPONENT 'HIGH' OF STRUCTURE <ls_line> TO <lv_comp>.
      IF sy-subrc = 0.
        <lv_comp> = ls_option-high.
      ENDIF.
      INSERT <ls_line> INTO TABLE et_select_option.
    ENDLOOP.
  ENDMETHOD.

* ---------------- single entity facets

  METHOD /iwbep/if_mgw_req_entity~get_entity_set_name.
    rv_entity_set = mv_entity_set.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity~get_entity_type_name.
    rv_entity_type = mv_entity_type.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity~get_source_entity_set_name.
    IF mv_source_entity_set IS NOT INITIAL.
      rv_entity_set = mv_source_entity_set.
    ELSE.
      rv_entity_set = mv_entity_set.
    ENDIF.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity~get_converted_keys.
    keys_to_structure( IMPORTING es_key_values = es_key_values ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity~get_converted_source_keys.
    keys_to_structure( IMPORTING es_key_values = es_key_values ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_c~get_entity_set_name.
    rv_entity_set = mv_entity_set.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_c~get_source_entity_set_name.
    IF mv_source_entity_set IS NOT INITIAL.
      rv_entity_set = mv_source_entity_set.
    ELSE.
      rv_entity_set = mv_entity_set.
    ENDIF.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_c~get_entity_type_name.
    rv_entity_type = mv_entity_type.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_d~get_entity_set_name.
    rv_entity_set = mv_entity_set.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_d~get_entity_type_name.
    rv_entity_type = mv_entity_type.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_d~get_converted_keys.
    keys_to_structure( IMPORTING es_key_values = es_key_values ).
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_u~get_entity_set_name.
    rv_entity_set = mv_entity_set.
  ENDMETHOD.

  METHOD /iwbep/if_mgw_req_entity_u~get_converted_keys.
    keys_to_structure( IMPORTING es_key_values = es_key_values ).
  ENDMETHOD.

ENDCLASS.
