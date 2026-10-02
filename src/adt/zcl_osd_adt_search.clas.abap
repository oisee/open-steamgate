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
    CLASS-METHODS reference IMPORTING io_json TYPE REF TO zcl_ajson iv_path TYPE string iv_type TYPE string
      RETURNING VALUE(rs_ref) TYPE zcl_osd_adt_doc_common=>ty_reference.
ENDCLASS.
CLASS zcl_osd_adt_search IMPLEMENTATION.
  METHOD matches.
    IF iv_pattern CS `*`.
      rv_yes = zcl_osd_adt_js=>glob( iv_pattern = iv_pattern iv_text = iv_name ).
    ELSE.
      rv_yes = boolc( iv_name CS iv_pattern ).
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
    rv_end = trunc( is_max-value ).
    IF rv_end < 0.
      rv_end = nmax( val1 = 0 val2 = iv_length + rv_end ).
    ENDIF.
  ENDMETHOD.
  METHOD reference.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    rs_ref-name = io_json->get_string( iv_path && `/name` ).
    rs_ref-type = zcl_osd_adt_types=>adt_type( iv_type ).
    lt_types = zcl_osd_adt_types=>all( ).
    READ TABLE lt_types INTO ls_type WITH KEY type = iv_type.
    IF sy-subrc <> 0.
      ls_type-collection = `unknown`.
    ENDIF.
    rs_ref-uri = `/sap/bc/adt/` && ls_type-collection && `/`
      && zcl_osd_adt_uri=>encode_component( to_lower( rs_ref-name ) ).
    rs_ref-has_uri = abap_true.
    IF io_json->get_boolean( iv_path && `/library` ) = abap_true.
      rs_ref-description = `library object`.
    ENDIF.
    rs_ref-has_description = boolc( rs_ref-description IS NOT INITIAL ).
  ENDMETHOD.
  METHOD packages.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA ls_ref TYPE zcl_osd_adt_doc_common=>ty_reference.
    DATA lv_end TYPE i.
    zcl_osd_adt_host=>require( `PACKAGES` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `PACKAGES` iv_json = `{}` ).
    lo_json = zcl_ajson=>parse( ls_answer-json ).
    lt_members = lo_json->members( `/` ).
    DO lines( lt_members ) TIMES.
      lv_member = sy-index.
      CONDENSE lv_member NO-GAPS.
      lv_path = `/` && lv_member.
      IF matches( iv_name = lo_json->get_string( lv_path && `/name` ) iv_pattern = iv_pattern ) = abap_true.
        ls_ref = reference( io_json = lo_json iv_path = lv_path iv_type = `DEVC` ).
        ls_ref-description = lo_json->get_string( lv_path && `/description` ).
        ls_ref-has_description = boolc( ls_ref-description IS NOT INITIAL ).
        APPEND ls_ref TO rt_refs.
      ENDIF.
    ENDDO.
    lv_end = slice_end( is_max = is_max iv_length = lines( rt_refs ) ).
    IF lv_end < lines( rt_refs ).
      lv_end = lv_end + 1.
      DELETE rt_refs FROM lv_end.
    ENDIF.
  ENDMETHOD.
  METHOD objects.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_parts TYPE string_table.
    DATA lt_members TYPE string_table.
    DATA lv_seed TYPE string.
    DATA lv_limit TYPE string.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA ls_ref TYPE zcl_osd_adt_doc_common=>ty_reference.
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
    lo_input->add( iv_name = `seed` iv_value = lv_seed ).
    lo_input->add( iv_name = `type` iv_value = iv_type ).
    lo_input->add_raw( iv_name = `limit` iv_json = lv_limit ).
    zcl_osd_adt_host=>require( `SEARCH` ).
    ls_answer = zcl_osd_adt_host=>store( iv_command = `SEARCH` iv_json = lo_input->document( ) ).
    lo_json = zcl_ajson=>parse( ls_answer-json ).
    lt_members = lo_json->members( `/` ).
    DO lines( lt_members ) TIMES.
      lv_member = sy-index.
      CONDENSE lv_member NO-GAPS.
      lv_path = `/` && lv_member.
      IF matches( iv_name = lo_json->get_string( lv_path && `/name` ) iv_pattern = iv_pattern ) = abap_false.
        CONTINUE.
      ENDIF.
      ls_ref = reference( io_json = lo_json iv_path = lv_path iv_type = lo_json->get_string( lv_path && `/type` ) ).
      APPEND ls_ref TO rt_refs.
      IF is_max-nan = abap_false AND ( is_max-infinity < 0 OR
          ( is_max-infinity = 0 AND lines( rt_refs ) >= is_max-value ) ).
        EXIT.
      ENDIF.
    ENDDO.
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
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `query` IMPORTING ev_value = lv_pattern ev_found = lv_found ).
    IF lv_found = abap_false.
      zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `search` IMPORTING ev_value = lv_pattern ).
    ENDIF.
    lv_pattern = to_upper( zcl_osd_adt_js=>trim( lv_pattern ) ).
    zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `objectType` IMPORTING ev_value = lv_type ev_found = lv_found ).
    IF lv_found = abap_false.
      zcl_osd_adt_package=>query( EXPORTING is_request = is_request iv_name = `type` IMPORTING ev_value = lv_type ).
    ENDIF.
    SPLIT to_upper( lv_type ) AT `/` INTO lv_type lv_max.
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
