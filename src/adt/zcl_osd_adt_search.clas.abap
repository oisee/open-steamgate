"! B6 quick search: package slice then index-ordered, seeded object hits.
CLASS zcl_osd_adt_search DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS document IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
      RETURNING VALUE(rv_body) TYPE string RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS matches IMPORTING iv_name TYPE string iv_pattern TYPE string
      RETURNING VALUE(rv_yes) TYPE abap_bool.
    CLASS-METHODS slice_end IMPORTING is_max TYPE zcl_osd_adt_js=>ty_number iv_length TYPE i
      RETURNING VALUE(rv_end) TYPE i.
  PRIVATE SECTION.
    CLASS-METHODS packages IMPORTING iv_pattern TYPE string is_max TYPE zcl_osd_adt_js=>ty_number
      RETURNING VALUE(rt_refs) TYPE zcl_osd_adt_doc_common=>tt_reference RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS objects IMPORTING iv_pattern TYPE string iv_type TYPE string is_max TYPE zcl_osd_adt_js=>ty_number
      RETURNING VALUE(rt_refs) TYPE zcl_osd_adt_doc_common=>tt_reference RAISING zcx_osd_adt zcx_ajson_error.
    CLASS-METHODS reference IMPORTING iv_name TYPE string iv_library TYPE string iv_type TYPE string it_types TYPE zcl_osd_adt_types=>tt_type
      RETURNING VALUE(rs_ref) TYPE zcl_osd_adt_doc_common=>ty_reference.
ENDCLASS.
CLASS zcl_osd_adt_search IMPLEMENTATION.
  METHOD matches.
    IF iv_pattern CS `*`.
      rv_yes = zcl_osd_adt_js=>glob( iv_pattern = iv_pattern iv_text = iv_name ).
    ELSE.
      rv_yes = boolc( find( val = iv_name sub = iv_pattern ) >= 0 ).
    ENDIF.
  ENDMETHOD.
  METHOD slice_end.
    IF is_max-nan = abap_true OR is_max-infinity < 0.
      RETURN.
    ENDIF.
    rv_end = iv_length.
    IF is_max-infinity > 0 OR is_max-value >= iv_length.
      RETURN.
    ENDIF.
    IF is_max-value <= - iv_length.
      rv_end = 0.
      RETURN.
    ENDIF.
    rv_end = trunc( is_max-value ).
    IF rv_end < 0.
      rv_end = nmax( val1 = 0 val2 = iv_length + rv_end ).
    ENDIF.
  ENDMETHOD.
  METHOD reference.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    rs_ref-name = iv_name.
    rs_ref-type = iv_type.
    READ TABLE it_types INTO ls_type WITH KEY type = iv_type.
    IF sy-subrc <> 0.
      ls_type-collection = `unknown`.
    ELSE.
      rs_ref-type = ls_type-adt_type.
    ENDIF.
    IF iv_type = `STRU`.
      rs_ref-type = `TABL/DS`.
    ENDIF.
    rs_ref-uri = `/sap/bc/adt/` && ls_type-collection && `/`
      && zcl_osd_adt_uri=>encode_component( to_lower( rs_ref-name ) ).
    rs_ref-has_uri = abap_true.
    IF iv_library = abap_true.
      rs_ref-description = `library object`.
    ENDIF.
    rs_ref-has_description = boolc( rs_ref-description IS NOT INITIAL ).
  ENDMETHOD.
  METHOD packages.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lt_lines TYPE string_table.
    DATA lv_line TYPE string.
    DATA lv_kind TYPE string.
    DATA lv_name TYPE string.
    DATA lv_parent TYPE string.
    DATA lv_description TYPE string.
    DATA lv_library TYPE string.
    DATA lv_root TYPE string.
    DATA ls_ref TYPE zcl_osd_adt_doc_common=>ty_reference.
    DATA lv_end TYPE i.
    zcl_osd_adt_host=>require( `PACKAGES` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PACKAGES` iv_json = `{"format":"lines"}` ).
    SPLIT ls_answer-source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line WHERE table_line IS NOT INITIAL.
      SPLIT lv_line AT cl_abap_char_utilities=>horizontal_tab INTO lv_kind lv_name lv_parent lv_description lv_library lv_root.
      IF matches( iv_name = lv_name iv_pattern = iv_pattern ) = abap_true.
        CLEAR ls_ref.
        ls_ref-name = lv_name.
        ls_ref-type = `DEVC/K`.
        ls_ref-uri = `/sap/bc/adt/packages/` && zcl_osd_adt_uri=>encode_component( to_lower( lv_name ) ).
        ls_ref-has_uri = abap_true.
        ls_ref-description = zcl_osd_adt_js=>unescape( lv_description ).
        ls_ref-has_description = boolc( ls_ref-description IS NOT INITIAL ).
        APPEND ls_ref TO rt_refs.
      ENDIF.
    ENDLOOP.
    lv_end = slice_end( is_max = is_max iv_length = lines( rt_refs ) ).
    IF lv_end < lines( rt_refs ).
      lv_end = lv_end + 1.
      DELETE rt_refs FROM lv_end.
    ENDIF.
  ENDMETHOD.
  METHOD objects.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.

    DATA lt_parts TYPE string_table.
    DATA lt_lines TYPE string_table.
    DATA lv_seed TYPE string.
    DATA lv_limit TYPE string.
    DATA lv_line TYPE string.
    DATA lv_name TYPE string.
    DATA lv_type TYPE string.
    DATA lv_library TYPE string.
    DATA ls_ref TYPE zcl_osd_adt_doc_common=>ty_reference.
    lt_types = zcl_osd_adt_types=>all( ).
    SPLIT iv_pattern AT `*` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_seed WHERE table_line IS NOT INITIAL.
      EXIT.
    ENDLOOP.
    lv_limit = `null`.
    IF is_max-nan = abap_false.
      lv_limit = `Infinity`.
      IF is_max-infinity < 0.
        lv_limit = `-Infinity`.
      ELSEIF is_max-infinity = 0.
        lv_limit = |{ is_max-value * 4 }|.
      ENDIF.
      lv_limit = zcl_osd_adt_json=>quote( lv_limit ).
    ENDIF.
    CREATE OBJECT lo_input.
    lo_input->add( iv_name = `format` iv_value = `lines` ).
    lo_input->add( iv_name = `seed` iv_value = lv_seed ).
    lo_input->add( iv_name = `type` iv_value = iv_type ).
    lo_input->add_raw( iv_name = `limit` iv_json = lv_limit ).
    zcl_osd_adt_host=>require( `SEARCH` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `SEARCH` iv_json = lo_input->document( ) ).
    SPLIT ls_answer-source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line WHERE table_line IS NOT INITIAL.
      SPLIT lv_line AT cl_abap_char_utilities=>horizontal_tab INTO lv_type lv_name lv_library.
      IF matches( iv_name = lv_name iv_pattern = iv_pattern ) = abap_false.
        CONTINUE.
      ENDIF.
      ls_ref = reference( iv_name = lv_name iv_library = lv_library iv_type = lv_type it_types = lt_types ).
      APPEND ls_ref TO rt_refs.
      IF is_max-nan = abap_false AND ( is_max-infinity < 0 OR
          ( is_max-infinity = 0 AND lines( rt_refs ) >= is_max-value ) ).
        EXIT.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD document.
    DATA lv_pattern TYPE string.
    DATA lv_type TYPE string.
    DATA lv_max TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA ls_max TYPE zcl_osd_adt_js=>ty_number.
    DATA lt_refs TYPE zcl_osd_adt_doc_common=>tt_reference.
    DATA lt_rest TYPE zcl_osd_adt_doc_common=>tt_reference.
    DATA lv_end TYPE i.
    DATA lv_given_type TYPE abap_bool.
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `query` IMPORTING ev_value = lv_pattern ev_found = lv_found ).
    IF lv_found = abap_false.
      zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `search` IMPORTING ev_value = lv_pattern ).
    ENDIF.
    lv_pattern = to_upper( zcl_osd_adt_js=>trim( lv_pattern ) ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `objectType` IMPORTING ev_value = lv_type ev_found = lv_found ).
    IF lv_found = abap_false.
      zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `type` IMPORTING ev_value = lv_type ).
    ENDIF.
    lv_given_type = boolc( lv_type IS NOT INITIAL ).
    SPLIT to_upper( lv_type ) AT `/` INTO lv_type lv_max.
    IF lv_given_type = abap_true AND lv_type IS INITIAL.
      rv_body = zcl_osd_adt_doc_common=>object_references( lt_refs ).
      RETURN.
    ENDIF.
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `maxResults` IMPORTING ev_value = lv_max ev_found = lv_found ).
    IF lv_found = abap_false.
      lv_max = `100`.
    ENDIF.
    ls_max = zcl_osd_adt_js=>number( lv_max ).
    IF lv_type IS INITIAL OR lv_type = `DEVC`.
      lt_refs = packages( iv_pattern = lv_pattern is_max = ls_max ).
      IF lv_type = `DEVC` OR ( ls_max-nan = abap_false AND ls_max-infinity = 0 AND lines( lt_refs ) >= ls_max-value )
          OR ls_max-infinity < 0.
        IF lv_type <> `DEVC`.
          lv_end = slice_end( is_max = ls_max iv_length = lines( lt_refs ) ).
          IF lv_end < lines( lt_refs ).
            lv_end = lv_end + 1.
            DELETE lt_refs FROM lv_end.
          ENDIF.
        ENDIF.
        rv_body = zcl_osd_adt_doc_common=>object_references( lt_refs ).
        RETURN.
      ENDIF.
      ls_max-value = ls_max-value - lines( lt_refs ).
    ENDIF.
    lt_rest = objects( iv_pattern = lv_pattern iv_type = lv_type is_max = ls_max ).
    APPEND LINES OF lt_rest TO lt_refs.
    rv_body = zcl_osd_adt_doc_common=>object_references( lt_refs ).
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    rs_response-status = 200.
    rs_response-content_type = `application/xml; charset=utf-8`.
    rs_response-body = document( is_request ).
  ENDMETHOD.
ENDCLASS.
