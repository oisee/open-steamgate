CLASS zcl_stg_url DEFINITION PUBLIC CREATE PUBLIC.
* OData v2 URL: /sap/opu/odata/sap/<Service>/<EntitySet>(<keys>)/$count?$opt=...
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_request,
             service         TYPE string,
             entity_set      TYPE string,
             key_string      TYPE string,
             is_service_root TYPE abap_bool,
             is_metadata     TYPE abap_bool,
             is_count        TYPE abap_bool,
             options         TYPE tihttpnvp,
           END OF ty_request.

    CLASS-METHODS parse
      IMPORTING
        iv_path           TYPE string
        it_options        TYPE tihttpnvp OPTIONAL
      RETURNING
        VALUE(rs_request) TYPE ty_request
      RAISING
        zcx_stg_error.

    CLASS-METHODS option
      IMPORTING
        is_request      TYPE ty_request
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.

    CLASS-METHODS parse_keys
      IMPORTING
        iv_key_string     TYPE string
        it_key_names      TYPE string_table
      RETURNING
        VALUE(rt_key_tab) TYPE /iwbep/t_mgw_name_value_pair
      RAISING
        zcx_stg_error.

    CLASS-METHODS unquote
      IMPORTING
        iv_value        TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS zcl_stg_url IMPLEMENTATION.

  METHOD parse.
    DATA lv_rest    TYPE string.
    DATA lv_segment TYPE string.
    DATA lv_tail    TYPE string.

    FIND REGEX '/sap/opu/odata/sap/([^/?]+)(.*)$' IN iv_path SUBMATCHES rs_request-service lv_rest.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 404
          code    = 'STG/NOT_ODATA'
          message = |Not an OData path: { iv_path }|.
    ENDIF.
    rs_request-options = it_options.

    IF lv_rest = '' OR lv_rest = '/'.
      rs_request-is_service_root = abap_true.
      RETURN.
    ENDIF.

    IF lv_rest CP '/$metadata*'.
      rs_request-is_metadata = abap_true.
      RETURN.
    ENDIF.

* /<EntitySet>(<keys>)/$count
    FIND REGEX '^/([^/(]+)(?:\(([^)]*)\))?(/\$count)?/?$' IN lv_rest
      SUBMATCHES lv_segment rs_request-key_string lv_tail.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 404
          code    = 'STG/BAD_RESOURCE_PATH'
          message = |Unsupported resource path: { lv_rest }|.
    ENDIF.
    rs_request-entity_set = cl_http_utility=>unescape_url( lv_segment ).
    rs_request-key_string = cl_http_utility=>unescape_url( rs_request-key_string ).
    IF lv_tail IS NOT INITIAL.
      rs_request-is_count = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD option.
    DATA ls_option LIKE LINE OF is_request-options.

    LOOP AT is_request-options INTO ls_option.
      IF to_lower( ls_option-name ) = to_lower( iv_name ).
        rv_value = ls_option-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD unquote.
    DATA lv_quote TYPE string.
    DATA lv_two   TYPE string.

    lv_quote = |'|.
    lv_two   = |''|.
    rv_value = iv_value.
    IF strlen( rv_value ) >= 2 AND rv_value(1) = lv_quote AND substring( val = rv_value
                                                                           off = strlen( rv_value ) - 1 ) = lv_quote.
      rv_value = substring( val = rv_value
                            off = 1
                            len = strlen( rv_value ) - 2 ).
      REPLACE ALL OCCURRENCES OF lv_two IN rv_value WITH lv_quote.
    ENDIF.
  ENDMETHOD.

  METHOD parse_keys.
    DATA lt_parts TYPE string_table.
    DATA lv_part  TYPE string.
    DATA ls_key   TYPE /iwbep/s_mgw_name_value_pair.
    DATA lv_name  TYPE string.

    IF iv_key_string IS INITIAL.
      RETURN.
    ENDIF.

    SPLIT iv_key_string AT ',' INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      CONDENSE lv_part.
      IF lv_part CS '='.
        SPLIT lv_part AT '=' INTO ls_key-name ls_key-value.
        CONDENSE ls_key-name.
        CONDENSE ls_key-value.
      ELSEIF lines( it_key_names ) = 1.
        READ TABLE it_key_names INDEX 1 INTO lv_name.
        ls_key-name  = lv_name.
        ls_key-value = lv_part.
      ELSE.
        RAISE EXCEPTION TYPE zcx_stg_error
          EXPORTING
            status  = 400
            code    = 'STG/BAD_KEY'
            message = |Key predicate must name every key property: { iv_key_string }|.
      ENDIF.
      ls_key-value = unquote( ls_key-value ).
      APPEND ls_key TO rt_key_tab.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
