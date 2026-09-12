CLASS zcl_stg_json DEFINITION PUBLIC CREATE PUBLIC.
* OData v2 JSON (verbose format, the one SEGW services speak) from typed
* ABAP data, driven by the model: property names, EDM types, keys.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_nav_json,
             name TYPE string,
             json TYPE string,
           END OF ty_nav_json.
    TYPES ty_nav_jsons TYPE STANDARD TABLE OF ty_nav_json WITH DEFAULT KEY.

* The serializer needs the other entity sets of the service to inline
* nested components; the dispatcher hands them over once per request.
    CLASS-METHODS register_sets
      IMPORTING
        it_sets TYPE zcl_stg_model_info=>ty_entity_sets.

    CLASS-METHODS feed_of
      IMPORTING
        it_entities    TYPE string_table
        iv_inlinecount TYPE string OPTIONAL
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS feed
      IMPORTING
        it_data        TYPE ANY TABLE
        is_set         TYPE zcl_stg_model_info=>ty_entity_set
        iv_namespace   TYPE string
        iv_base_url    TYPE string
        iv_inlinecount TYPE string OPTIONAL
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS entry
      IMPORTING
        is_data        TYPE any
        is_set         TYPE zcl_stg_model_info=>ty_entity_set
        iv_namespace   TYPE string
        iv_base_url    TYPE string
        it_nav_json    TYPE ty_nav_jsons OPTIONAL
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS entity
      IMPORTING
        is_data        TYPE any
        is_set         TYPE zcl_stg_model_info=>ty_entity_set
        iv_namespace   TYPE string
        iv_base_url    TYPE string
        it_nav_json    TYPE ty_nav_jsons OPTIONAL
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS key_predicate
      IMPORTING
        is_data          TYPE any
        is_set           TYPE zcl_stg_model_info=>ty_entity_set
      RETURNING
        VALUE(rv_string) TYPE string.

    CLASS-METHODS value
      IMPORTING
        iv_value       TYPE any
        iv_edm_type    TYPE string
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS escape
      IMPORTING
        iv_string        TYPE string
      RETURNING
        VALUE(rv_string) TYPE string.

    CLASS-METHODS error
      IMPORTING
        iv_code        TYPE string
        iv_message     TYPE string
      RETURNING
        VALUE(rv_json) TYPE string.

* One JSON object -> name/value pairs. Accepts the v2 {"d":{...}} wrapper,
* skips __metadata, keeps numbers, booleans and null as their literal text.
* A nested object or array (deep insert, navigation payload) is kept as its
* raw JSON text and listed in et_nested by name.
    CLASS-METHODS parse_object
      IMPORTING
        iv_json          TYPE string
      EXPORTING
        et_nested        TYPE tihttpnvp
      RETURNING
        VALUE(rt_values) TYPE tihttpnvp
      RAISING
        zcx_stg_error.

* A JSON array of objects -> one raw JSON text per element.
    CLASS-METHODS parse_array
      IMPORTING
        iv_json            TYPE string
      RETURNING
        VALUE(rt_elements) TYPE string_table
      RAISING
        zcx_stg_error.
  PRIVATE SECTION.
    CLASS-DATA gt_sets TYPE zcl_stg_model_info=>ty_entity_sets.

    CLASS-METHODS nested
      IMPORTING
        is_data        TYPE any
        is_nav         TYPE zcl_stg_model_info=>ty_nav
        is_set         TYPE zcl_stg_model_info=>ty_entity_set
        iv_namespace   TYPE string
        iv_base_url    TYPE string
      RETURNING
        VALUE(rv_json) TYPE string.

    CLASS-METHODS read_string
      IMPORTING
        iv_json         TYPE string
      CHANGING
        cv_off          TYPE i
      RETURNING
        VALUE(rv_value) TYPE string
      RAISING
        zcx_stg_error.

    CLASS-METHODS skip_value
      IMPORTING
        iv_json TYPE string
      CHANGING
        cv_off  TYPE i.

    CLASS-METHODS skip_blanks
      IMPORTING
        iv_json TYPE string
      CHANGING
        cv_off  TYPE i.

    CLASS-METHODS epoch_ms
      IMPORTING
        iv_date      TYPE d
        iv_time      TYPE t
      RETURNING
        VALUE(rv_ms) TYPE string.
ENDCLASS.

CLASS zcl_stg_json IMPLEMENTATION.

  METHOD escape.
    rv_string = iv_string.
    REPLACE ALL OCCURRENCES OF '\' IN rv_string WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_string WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_string WITH '\r\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_string WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_string WITH '\t'.
  ENDMETHOD.

  METHOD error.
    rv_json = |\{"error":\{"code":"{ escape( iv_code ) }","message":\{"lang":"en","value":"{ escape( iv_message ) }"\}\}\}|.
  ENDMETHOD.

  METHOD nested.
    DATA ls_target TYPE zcl_stg_model_info=>ty_entity_set.
    DATA lv_kind   TYPE c LENGTH 1.
    FIELD-SYMBOLS <lv_comp>  TYPE any.
    FIELD-SYMBOLS <lt_table> TYPE ANY TABLE.

    ASSIGN COMPONENT is_nav-name OF STRUCTURE is_data TO <lv_comp>.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
* the target set's shape comes from the same service the caller resolved
    READ TABLE gt_sets INTO ls_target WITH KEY name = is_nav-target_set.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    DESCRIBE FIELD <lv_comp> TYPE lv_kind.
    IF lv_kind = 'h'.
      ASSIGN <lv_comp> TO <lt_table>.
      rv_json = feed( it_data      = <lt_table>
                      is_set       = ls_target
                      iv_namespace = iv_namespace
                      iv_base_url  = iv_base_url ).
      rv_json = substring( val = rv_json
                           off = 5
                           len = strlen( rv_json ) - 6 ).
    ELSEIF lv_kind = 'u' OR lv_kind = 'v'.
      IF <lv_comp> IS INITIAL.
        RETURN.
      ENDIF.
      rv_json = entity( is_data      = <lv_comp>
                        is_set       = ls_target
                        iv_namespace = iv_namespace
                        iv_base_url  = iv_base_url ).
    ENDIF.
  ENDMETHOD.

  METHOD register_sets.
    gt_sets = it_sets.
  ENDMETHOD.

  METHOD skip_blanks.
    DATA lv_len TYPE i.

    lv_len = strlen( iv_json ).
    WHILE cv_off < lv_len AND iv_json+cv_off(1) IS INITIAL.
      cv_off = cv_off + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD read_string.
    DATA lv_len   TYPE i.
    DATA lv_piece TYPE string.
    DATA lv_hex   TYPE string.
    DATA lv_x     TYPE x LENGTH 2.

    lv_len = strlen( iv_json ).
* cv_off is on the opening quote
    cv_off = cv_off + 1.
    WHILE cv_off < lv_len.
      lv_piece = iv_json+cv_off(1).
      IF lv_piece = '"'.
        cv_off = cv_off + 1.
        RETURN.
      ELSEIF lv_piece = '\'.
        cv_off = cv_off + 1.
        lv_piece = iv_json+cv_off(1).
        CASE lv_piece.
          WHEN 'n'.
            lv_piece = cl_abap_char_utilities=>newline.
          WHEN 'r'.
            lv_piece = cl_abap_char_utilities=>cr_lf(1).
          WHEN 't'.
            lv_piece = cl_abap_char_utilities=>horizontal_tab.
          WHEN 'u'.
            cv_off = cv_off + 1.
            lv_hex = iv_json+cv_off(4).
            lv_x = lv_hex.
            lv_piece = cl_abap_conv_in_ce=>uccp( lv_x ).
            cv_off = cv_off + 3.
          WHEN OTHERS.
* \" \\ \/ and anything else: the character itself
            lv_piece = iv_json+cv_off(1).
        ENDCASE.
      ENDIF.
      rv_value = rv_value && lv_piece.
      cv_off = cv_off + 1.
    ENDWHILE.
    RAISE EXCEPTION TYPE zcx_stg_error
      EXPORTING
        status  = 400
        code    = 'STG/BAD_JSON'
        message = 'Unterminated string in request body'.
  ENDMETHOD.

  METHOD skip_value.
    DATA lv_len   TYPE i.
    DATA lv_depth TYPE i.
    DATA lv_char  TYPE string.
    DATA lv_in    TYPE abap_bool.

    lv_len = strlen( iv_json ).
    WHILE cv_off < lv_len.
      lv_char = iv_json+cv_off(1).
      IF lv_in = abap_true.
        IF lv_char = '\'.
          cv_off = cv_off + 1.
        ELSEIF lv_char = '"'.
          lv_in = abap_false.
        ENDIF.
      ELSEIF lv_char = '"'.
        lv_in = abap_true.
      ELSEIF lv_char = '{' OR lv_char = '['.
        lv_depth = lv_depth + 1.
      ELSEIF lv_char = '}' OR lv_char = ']'.
        IF lv_depth = 0.
          RETURN.
        ENDIF.
        lv_depth = lv_depth - 1.
      ELSEIF lv_char = ',' AND lv_depth = 0.
        RETURN.
      ENDIF.
      cv_off = cv_off + 1.
    ENDWHILE.
  ENDMETHOD.

  METHOD parse_array.
    DATA lv_off   TYPE i.
    DATA lv_len   TYPE i.
    DATA lv_char  TYPE string.
    DATA lv_start TYPE i.
    DATA lv_count TYPE i.
    DATA lv_elem  TYPE string.

    lv_len = strlen( iv_json ).
    skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
    IF lv_off >= lv_len OR iv_json+lv_off(1) <> '['.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 400
          code    = 'STG/BAD_JSON'
          message = 'Expected a JSON array'.
    ENDIF.
    lv_off = lv_off + 1.
    DO.
      skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      IF lv_off >= lv_len.
        EXIT.
      ENDIF.
      lv_char = iv_json+lv_off(1).
      IF lv_char = ']'.
        EXIT.
      ELSEIF lv_char = ','.
        lv_off = lv_off + 1.
        CONTINUE.
      ENDIF.
      lv_start = lv_off.
* skip_value counts the brackets itself and stops on the , or ] that ends
* this element
      skip_value( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      IF lv_off = lv_start.
        RAISE EXCEPTION TYPE zcx_stg_error
          EXPORTING
            status  = 400
            code    = 'STG/BAD_JSON'
            message = |Unexpected { lv_char } at { lv_off } in array|.
      ENDIF.
      lv_count = lv_off - lv_start.
      lv_elem = iv_json+lv_start(lv_count).
      CONDENSE lv_elem.
      APPEND lv_elem TO rt_elements.
    ENDDO.
  ENDMETHOD.

  METHOD parse_object.
    DATA lv_off   TYPE i.
    DATA lv_len   TYPE i.
    DATA lv_char  TYPE string.
    DATA lv_name  TYPE string.
    DATA lv_start TYPE i.
    DATA lv_count TYPE i.
    DATA ls_pair  TYPE ihttpnvp.

    CLEAR et_nested.
    lv_len = strlen( iv_json ).
    skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
    IF lv_off >= lv_len OR iv_json+lv_off(1) <> '{'.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 400
          code    = 'STG/BAD_JSON'
          message = 'Request body must be a JSON object'.
    ENDIF.
    lv_off = lv_off + 1.

    DO.
      skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      IF lv_off >= lv_len.
        EXIT.
      ENDIF.
      lv_char = iv_json+lv_off(1).
      IF lv_char = '}'.
        EXIT.
      ELSEIF lv_char = ','.
        lv_off = lv_off + 1.
        CONTINUE.
      ELSEIF lv_char <> '"'.
        RAISE EXCEPTION TYPE zcx_stg_error
          EXPORTING
            status  = 400
            code    = 'STG/BAD_JSON'
            message = |Unexpected { lv_char } at { lv_off } in request body|.
      ENDIF.

      lv_name = read_string( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      IF lv_off >= lv_len OR iv_json+lv_off(1) <> ':'.
        RAISE EXCEPTION TYPE zcx_stg_error
          EXPORTING
            status  = 400
            code    = 'STG/BAD_JSON'
            message = |Expected : after { lv_name } in request body|.
      ENDIF.
      lv_off = lv_off + 1.
      skip_blanks( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      lv_char = iv_json+lv_off(1).

      IF lv_name = 'd' AND lv_char = '{'.
* v2 wrapper: descend
        lv_off = lv_off + 1.
        CONTINUE.
      ENDIF.

      CLEAR ls_pair.
      ls_pair-name = lv_name.
      IF lv_char = '"'.
        ls_pair-value = read_string( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
      ELSEIF lv_char = '{' OR lv_char = '['.
* nested object or array: __metadata and deferred links are dropped,
* everything else is a navigation payload for a deep insert
        lv_start = lv_off.
        skip_value( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
        IF lv_name <> '__metadata'.
          lv_count = lv_off - lv_start.
          ls_pair-value = iv_json+lv_start(lv_count).
          IF ls_pair-value CS '"__deferred"'.
            CONTINUE.
          ENDIF.
          APPEND ls_pair TO et_nested.
        ENDIF.
        CONTINUE.
      ELSE.
        lv_start = lv_off.
        skip_value( EXPORTING iv_json = iv_json CHANGING cv_off = lv_off ).
        lv_count = lv_off - lv_start.
        ls_pair-value = iv_json+lv_start(lv_count).
        CONDENSE ls_pair-value.
      ENDIF.
      IF lv_name <> '__metadata'.
        APPEND ls_pair TO rt_values.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD epoch_ms.
    DATA lv_epoch   TYPE d VALUE '19700101'.
    DATA lv_days    TYPE i.
    DATA lv_seconds TYPE i.
    DATA lv_hh      TYPE i.
    DATA lv_mm      TYPE i.
    DATA lv_ss      TYPE i.

    lv_days = iv_date - lv_epoch.
    IF iv_time IS NOT INITIAL.
      lv_hh = iv_time(2).
      lv_mm = iv_time+2(2).
      lv_ss = iv_time+4(2).
      lv_seconds = lv_hh * 3600 + lv_mm * 60 + lv_ss.
    ENDIF.
    rv_ms = |{ ( lv_days * 86400 + lv_seconds ) * 1000 }|.
    CONDENSE rv_ms NO-GAPS.
  ENDMETHOD.

  METHOD value.
    DATA lv_string TYPE string.
    DATA lv_kind   TYPE c LENGTH 1.
    DATA lv_date   TYPE d.
    DATA lv_time   TYPE t.

    DESCRIBE FIELD iv_value TYPE lv_kind.

    CASE iv_edm_type.
      WHEN 'Edm.Int16' OR 'Edm.Int32' OR 'Edm.Byte'.
        lv_string = |{ iv_value }|.
        CONDENSE lv_string NO-GAPS.
        IF lv_string IS INITIAL.
          lv_string = '0'.
        ENDIF.
        rv_json = lv_string.
      WHEN 'Edm.Boolean'.
        IF iv_value IS INITIAL.
          rv_json = 'false'.
        ELSE.
          rv_json = 'true'.
        ENDIF.
      WHEN 'Edm.Decimal'.
        lv_string = |{ iv_value }|.
        CONDENSE lv_string NO-GAPS.
        rv_json = |"{ lv_string }"|.
      WHEN 'Edm.DateTime'.
        IF iv_value IS INITIAL.
          rv_json = 'null'.
        ELSEIF lv_kind = 'D'.
          lv_date = iv_value.
          rv_json = |"\\/Date({ epoch_ms( iv_date = lv_date iv_time = lv_time ) })\\/"|.
        ELSE.
* timestamp YYYYMMDDHHMMSS, possibly with fraction
          lv_string = |{ iv_value }|.
          CONDENSE lv_string NO-GAPS.
          lv_date = lv_string(8).
          IF strlen( lv_string ) >= 14.
            lv_time = lv_string+8(6).
          ENDIF.
          rv_json = |"\\/Date({ epoch_ms( iv_date = lv_date iv_time = lv_time ) })\\/"|.
        ENDIF.
      WHEN 'Edm.Time'.
        lv_string = iv_value.
        IF strlen( lv_string ) >= 6.
          rv_json = |"PT{ lv_string(2) }H{ lv_string+2(2) }M{ lv_string+4(2) }S"|.
        ELSE.
          rv_json = '"PT00H00M00S"'.
        ENDIF.
      WHEN OTHERS.
        lv_string = iv_value.
        rv_json = |"{ escape( lv_string ) }"|.
    ENDCASE.
  ENDMETHOD.

  METHOD key_predicate.
    DATA ls_property LIKE LINE OF is_set-properties.
    DATA lv_keys     TYPE i.
    DATA lv_value    TYPE string.
    DATA lv_literal  TYPE string.
    DATA lv_quote    TYPE string.
    DATA lv_two      TYPE string.
    FIELD-SYMBOLS <lv_field> TYPE any.

    lv_quote = |'|.
    lv_two   = ''''''.
    LOOP AT is_set-properties INTO ls_property WHERE is_key = abap_true.
      lv_keys = lv_keys + 1.
    ENDLOOP.

    LOOP AT is_set-properties INTO ls_property WHERE is_key = abap_true.
      ASSIGN COMPONENT ls_property-fieldname OF STRUCTURE is_data TO <lv_field>.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      CASE ls_property-edm_type.
        WHEN 'Edm.Int16' OR 'Edm.Int32' OR 'Edm.Byte' OR 'Edm.Boolean' OR 'Edm.Decimal'.
          lv_literal = value( iv_value    = <lv_field>
                              iv_edm_type = ls_property-edm_type ).
          REPLACE ALL OCCURRENCES OF '"' IN lv_literal WITH ''.
        WHEN OTHERS.
          lv_value = <lv_field>.
          REPLACE ALL OCCURRENCES OF lv_quote IN lv_value WITH lv_two.
          lv_literal = |'{ lv_value }'|.
      ENDCASE.
      IF lv_keys = 1.
        rv_string = lv_literal.
      ELSEIF rv_string IS INITIAL.
        rv_string = |{ ls_property-name }={ lv_literal }|.
      ELSE.
        rv_string = |{ rv_string },{ ls_property-name }={ lv_literal }|.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD entity.
    DATA ls_property LIKE LINE OF is_set-properties.
    DATA lv_uri      TYPE string.
    DATA lv_fields   TYPE string.
    DATA ls_nav      LIKE LINE OF is_set-navs.
    DATA ls_nav_json LIKE LINE OF it_nav_json.
    DATA lv_nested   TYPE string.
    FIELD-SYMBOLS <lv_field> TYPE any.

    lv_uri = |{ iv_base_url }/{ is_set-name }({ key_predicate( is_data = is_data is_set = is_set ) })|.

    LOOP AT is_set-properties INTO ls_property.
      ASSIGN COMPONENT ls_property-fieldname OF STRUCTURE is_data TO <lv_field>.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      lv_fields = |{ lv_fields },"{ ls_property-name }":{ value( iv_value    = <lv_field>
                                                                 iv_edm_type = ls_property-edm_type ) }|.
    ENDLOOP.

* navigation properties: expanded content when the caller supplies it, a
* nested component of a deep structure (what a DPC returns from
* create_deep_entity / get_expanded_*) when the data carries one, the v2
* deferred link otherwise
    LOOP AT is_set-navs INTO ls_nav.
      READ TABLE it_nav_json INTO ls_nav_json WITH KEY name = ls_nav-name.
      IF sy-subrc = 0.
        lv_fields = |{ lv_fields },"{ ls_nav-name }":{ ls_nav_json-json }|.
        CONTINUE.
      ENDIF.
      lv_nested = nested( is_data      = is_data
                          is_nav       = ls_nav
                          is_set       = is_set
                          iv_namespace = iv_namespace
                          iv_base_url  = iv_base_url ).
      IF lv_nested IS NOT INITIAL.
        lv_fields = |{ lv_fields },"{ ls_nav-name }":{ lv_nested }|.
      ELSE.
        lv_fields = |{ lv_fields },"{ ls_nav-name }":\{"__deferred":\{"uri":"{ lv_uri }/{ ls_nav-name }"\}\}|.
      ENDIF.
    ENDLOOP.

    rv_json = |\{"__metadata":\{"id":"{ lv_uri }","uri":"{ lv_uri }","type":"{ iv_namespace }.{ is_set-entity_type }"\}{ lv_fields }\}|.
  ENDMETHOD.

  METHOD entry.
    rv_json = |\{"d":{ entity( is_data      = is_data
                                is_set       = is_set
                                iv_namespace = iv_namespace
                                iv_base_url  = iv_base_url
                                it_nav_json  = it_nav_json ) }\}|.
  ENDMETHOD.

  METHOD feed_of.
    DATA lv_rows TYPE string.
    DATA lv_row  TYPE string.

    LOOP AT it_entities INTO lv_row.
      IF lv_rows IS INITIAL.
        lv_rows = lv_row.
      ELSE.
        lv_rows = |{ lv_rows },{ lv_row }|.
      ENDIF.
    ENDLOOP.

    rv_json = |\{"d":\{"results":[{ lv_rows }]|.
    IF iv_inlinecount IS NOT INITIAL.
      rv_json = |{ rv_json },"__count":"{ iv_inlinecount }"|.
    ENDIF.
    rv_json = |{ rv_json }\}\}|.
  ENDMETHOD.

  METHOD feed.
    DATA lt_entities TYPE string_table.
    FIELD-SYMBOLS <ls_row> TYPE any.

    LOOP AT it_data ASSIGNING <ls_row>.
      APPEND entity( is_data      = <ls_row>
                     is_set       = is_set
                     iv_namespace = iv_namespace
                     iv_base_url  = iv_base_url ) TO lt_entities.
    ENDLOOP.
    rv_json = feed_of( it_entities    = lt_entities
                       iv_inlinecount = iv_inlinecount ).
  ENDMETHOD.

ENDCLASS.
