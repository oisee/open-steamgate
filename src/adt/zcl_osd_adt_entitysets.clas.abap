"! A10: source-derived SEGW entity sets; host supplies registration facts.
CLASS zcl_osd_adt_entitysets DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS sets IMPORTING iv_dpc TYPE string iv_mpc TYPE string
      RETURNING VALUE(rv_json) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_pair,
             key TYPE string,
             value TYPE string,
           END OF ty_pair.
    TYPES tt_pair TYPE STANDARD TABLE OF ty_pair WITH DEFAULT KEY.
    CLASS-METHODS scan IMPORTING iv_text TYPE string iv_regex TYPE string
      RETURNING VALUE(rt_pairs) TYPE tt_pair.
    CLASS-METHODS names IMPORTING iv_mpc TYPE string RETURNING VALUE(rt_names) TYPE tt_pair.
    CLASS-METHODS methods IMPORTING iv_dpc TYPE string iv_kind TYPE string it_names TYPE tt_pair
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS resolve IMPORTING iv_prefix TYPE string it_names TYPE tt_pair
      EXPORTING ev_value TYPE string ev_found TYPE abap_bool.
    CLASS-METHODS source IMPORTING iv_name TYPE string
      EXPORTING ev_source TYPE string ev_found TYPE abap_bool.
    CLASS-METHODS read IMPORTING iv_name TYPE string
      EXPORTING ev_source TYPE string ev_found TYPE abap_bool.
ENDCLASS.
CLASS zcl_osd_adt_entitysets IMPLEMENTATION.
  METHOD scan.
    DATA lt_matches TYPE match_result_tab.
    DATA ls_match TYPE match_result.
    DATA ls_pair TYPE ty_pair.
    DATA lv_text TYPE string.
    FIND ALL OCCURRENCES OF REGEX iv_regex IN iv_text IGNORING CASE RESULTS lt_matches.
    LOOP AT lt_matches INTO ls_match.
      lv_text = iv_text+ls_match-offset(ls_match-length).
      CLEAR ls_pair.
      FIND REGEX iv_regex IN lv_text IGNORING CASE SUBMATCHES ls_pair-key ls_pair-value.
      APPEND ls_pair TO rt_pairs.
    ENDLOOP.
  ENDMETHOD.
  METHOD names.
    DATA lt_constants TYPE tt_pair.
    DATA lt_matches TYPE tt_pair.
    DATA ls_pair TYPE ty_pair.
    DATA ls_name TYPE ty_pair.
    FIELD-SYMBOLS <ls_pair> TYPE ty_pair.
    lt_matches = scan( iv_text = iv_mpc
      iv_regex = `CONSTANTS\s+(\S+)\s+TYPE\s+\S*ty_e_med_entity_name\S*\s+VALUE\s+'([^']*)'` ).
    LOOP AT lt_matches INTO ls_pair.
      ls_pair-key = to_upper( ls_pair-key ).
      READ TABLE lt_constants WITH KEY key = ls_pair-key ASSIGNING <ls_pair>.
      IF sy-subrc = 0.
        <ls_pair>-value = ls_pair-value.
      ELSE.
        APPEND ls_pair TO lt_constants.
      ENDIF.
    ENDLOOP.
    LOOP AT lt_constants INTO ls_pair.
      ls_name-key = to_lower( ls_pair-value ).
      ls_name-value = ls_pair-value.
      READ TABLE rt_names WITH KEY key = ls_name-key ASSIGNING <ls_pair>.
      IF sy-subrc = 0.
        <ls_pair>-value = ls_name-value.
      ELSE.
        APPEND ls_name TO rt_names.
      ENDIF.
    ENDLOOP.
    lt_matches = scan( iv_text = iv_mpc iv_regex = `->create_entity_set\s*\(\s*'([^']+)'` ).
    LOOP AT lt_matches INTO ls_pair.
      ls_name-key = to_lower( ls_pair-key ).
      ls_name-value = ls_pair-key.
      READ TABLE rt_names WITH KEY key = ls_name-key ASSIGNING <ls_pair>.
      IF sy-subrc = 0.
        <ls_pair>-value = ls_name-value.
      ELSE.
        APPEND ls_name TO rt_names.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD resolve.
    DATA ls_name TYPE ty_pair.
    DATA lv_count TYPE i.
    DATA lv_prefix TYPE string.
    CLEAR: ev_found, ev_value.
    lv_prefix = to_lower( iv_prefix ).
    LOOP AT it_names INTO ls_name.
      IF strlen( lv_prefix ) = 16.
        IF strlen( ls_name-key ) < 16 OR ls_name-key(16) <> lv_prefix.
          CONTINUE.
        ENDIF.
      ELSEIF ls_name-key <> lv_prefix.
        CONTINUE.
      ENDIF.
      lv_count = lv_count + 1.
      ev_value = ls_name-value.
    ENDLOOP.
    ev_found = boolc( lv_count = 1 ).
  ENDMETHOD.
  METHOD methods.
    DATA lt_lines TYPE string_table.
    DATA lt_seen TYPE string_table.
    DATA lv_line TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_method TYPE string.
    DATA lv_value TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_regex TYPE string.
    DATA lv_last TYPE i.
    DATA lo_row TYPE REF TO zcl_osd_adt_json.
    lv_regex = `^[ \t]*METHOD\s+(\w+)_` && iv_kind && `\s*\.[ \t]*$`.
    SPLIT iv_dpc AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line.
      lv_last = strlen( lv_line ) - 1.
      IF lv_last >= 0 AND lv_line+lv_last = cl_abap_char_utilities=>cr_lf(1).
        lv_line = lv_line(lv_last).
      ENDIF.
      FIND REGEX lv_regex IN lv_line IGNORING CASE SUBMATCHES lv_prefix.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      resolve( EXPORTING iv_prefix = lv_prefix it_names = it_names IMPORTING ev_value = lv_value ev_found = lv_found ).
      IF lv_found = abap_false.
        CONTINUE.
      ENDIF.
      lv_method = to_upper( lv_prefix && `_` && iv_kind ).
      READ TABLE lt_seen WITH KEY table_line = lv_method TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        CONTINUE.
      ENDIF.
      APPEND lv_method TO lt_seen.
      CREATE OBJECT lo_row.
      lo_row->add( iv_name = `method` iv_value = lv_method ).
      lo_row->add( iv_name = `kind` iv_value = iv_kind ).
      lo_row->add( iv_name = `set` iv_value = lv_value ).
      IF rv_json IS NOT INITIAL.
        rv_json = rv_json && `,`.
      ENDIF.
      rv_json = rv_json && lo_row->document( ).
    ENDLOOP.
  ENDMETHOD.
  METHOD sets.
    DATA lt_names TYPE tt_pair.
    DATA lv_entities TYPE string.
    lt_names = names( iv_mpc ).
    rv_json = methods( iv_dpc = iv_dpc iv_kind = `get_entityset` it_names = lt_names ).
    lv_entities = methods( iv_dpc = iv_dpc iv_kind = `get_entity` it_names = lt_names ).
    IF rv_json IS NOT INITIAL AND lv_entities IS NOT INITIAL.
      rv_json = rv_json && `,`.
    ENDIF.
    rv_json = `[` && rv_json && lv_entities && `]`.
  ENDMETHOD.
  METHOD read.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    CLEAR: ev_source, ev_found.
    TRY.
        ls_answer = zcl_osd_adt_host=>store( iv_command = `READ` iv_type = `CLAS` iv_name = iv_name ).
        ev_source = ls_answer-source.
        ev_found = abap_true.
      CATCH zcx_osd_adt.
        RETURN.
    ENDTRY.
  ENDMETHOD.
  METHOD source.
    DATA lv_last TYPE i.
    DATA lv_base TYPE string.
    DATA lv_found TYPE abap_bool.
    read( EXPORTING iv_name = iv_name IMPORTING ev_source = ev_source ev_found = ev_found ).
    lv_last = strlen( iv_name ) - 4.
    IF lv_last >= 0 AND to_upper( iv_name+lv_last ) = `_EXT`.
      read( EXPORTING iv_name = substring( val = iv_name len = lv_last ) IMPORTING ev_source = lv_base ev_found = lv_found ).
      IF lv_found = abap_true.
        IF ev_found = abap_true.
          ev_source = ev_source && cl_abap_char_utilities=>newline.
        ENDIF.
        ev_source = ev_source && lv_base.
        ev_found = abap_true.
      ENDIF.
    ENDIF.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_name TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_json TYPE string.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_rows TYPE string_table.
    DATA lv_row TYPE string.
    DATA lv_path TYPE string.
    DATA lv_dpc TYPE string.
    DATA lv_mpc TYPE string.
    DATA lv_service TYPE string.
    DATA lv_dpc_source TYPE string.
    DATA lv_mpc_source TYPE string.
    DATA lv_dpc_found TYPE abap_bool.
    DATA lv_mpc_found TYPE abap_bool.
    DATA lo_writer TYPE REF TO zcl_osd_adt_json.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `class`
      IMPORTING ev_value = lv_name ev_found = lv_found ).
    lv_name = to_upper( lv_name ).
    IF lv_name IS INITIAL.
      lx_error = zcx_osd_adt=>invalid_request( `class is required` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    zcl_osd_adt_host=>require( `SYSTEM` ).
    TRY.
        lv_json = zcl_osd_adt_host=>system( `SEGW_REGISTRATIONS` ).
        lo_json = zcl_ajson=>parse( iv_json = lv_json iv_keep_item_order = abap_true ).
        lt_rows = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/` ).
        LOOP AT lt_rows INTO lv_row.
          lv_path = `/` && lv_row.
          lv_dpc = lo_json->get_string( lv_path && `/dpc` ).
          IF to_upper( lv_dpc ) <> lv_name.
            CONTINUE.
          ENDIF.
          lv_mpc = lo_json->get_string( lv_path && `/mpc` ).
          lv_service = lo_json->get_string( lv_path && `/external` ).
          IF lv_service IS INITIAL.
            lv_service = lo_json->get_string( lv_path && `/service` ).
          ENDIF.
          EXIT.
        ENDLOOP.
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid SEGW_REGISTRATIONS answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    IF lv_mpc IS NOT INITIAL AND lv_dpc IS NOT INITIAL.
      source( EXPORTING iv_name = lv_dpc IMPORTING ev_source = lv_dpc_source ev_found = lv_dpc_found ).
      source( EXPORTING iv_name = lv_mpc IMPORTING ev_source = lv_mpc_source ev_found = lv_mpc_found ).
    ENDIF.
    IF lv_dpc_found = abap_false OR lv_mpc_found = abap_false.
      lx_error = zcx_osd_adt=>not_found( lv_name && ` is not a registered service's _DPC_EXT with a known MPC` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    CREATE OBJECT lo_writer.
    lo_writer->add( iv_name = `class` iv_value = lv_dpc ).
    lo_writer->add( iv_name = `service` iv_value = lv_service ).
    lo_writer->add( iv_name = `mpc` iv_value = lv_mpc ).
    lo_writer->add_raw( iv_name = `sets` iv_json = sets( iv_dpc = lv_dpc_source iv_mpc = lv_mpc_source ) ).
    rs_response-status = 200.
    rs_response-content_type = `application/json; charset=utf-8`.
    rs_response-body = lo_writer->document( ).
  ENDMETHOD.
ENDCLASS.
