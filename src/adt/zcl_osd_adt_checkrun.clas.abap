"! C1: request scanning and reports in ABAP, analysis through CHECKRUN.
CLASS zcl_osd_adt_checkrun DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS reporters RETURNING VALUE(rv_xml) TYPE string.
    CLASS-METHODS decode_content IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS document IMPORTING iv_body TYPE string RETURNING VALUE(rv_xml) TYPE string RAISING zcx_osd_adt.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_object,
             type TYPE string,
             name TYPE string,
             uri TYPE string,
             include TYPE string,
             source TYPE string,
             has_source TYPE abap_bool,
           END OF ty_object.
    TYPES tt_object TYPE STANDARD TABLE OF ty_object WITH DEFAULT KEY.
    CLASS-METHODS take IMPORTING iv_text TYPE string iv_open TYPE string iv_close TYPE string
      EXPORTING ev_value TYPE string ev_found TYPE abap_bool CHANGING cv_offset TYPE i.
    CLASS-METHODS object IMPORTING iv_uri TYPE string iv_canonical TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rs_object) TYPE ty_object RAISING zcx_osd_adt.
    CLASS-METHODS uri IMPORTING iv_type TYPE string iv_name TYPE string RETURNING VALUE(rv_uri) TYPE string.
    CLASS-METHODS packages IMPORTING iv_body TYPE string CHANGING ct_objects TYPE tt_object
      ct_reports TYPE zcl_osd_adt_checkreport=>tt_report RAISING zcx_osd_adt.
    CLASS-METHODS report IMPORTING is_object TYPE ty_object
      RETURNING VALUE(rs_report) TYPE zcl_osd_adt_checkreport=>ty_report RAISING zcx_osd_adt.
ENDCLASS.
CLASS zcl_osd_adt_checkrun IMPLEMENTATION.
  METHOD reporters.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?><chkrun:checkReporters xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:reporter chkrun:name="abapCheckRun">`.
    lt_types = zcl_osd_adt_types=>all( ).
    LOOP AT lt_types INTO ls_type.
      rv_xml = rv_xml && `<chkrun:supportedType>` && ls_type-type && `*</chkrun:supportedType>`.
    ENDLOOP.
    rv_xml = rv_xml && `</chkrun:reporter></chkrun:checkReporters>`.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_body TYPE string.
    IF is_request-method = `GET` OR is_request-method = `HEAD`.
      rs_response-body = reporters( ).
      rs_response-content_type = `application/vnd.sap.adt.reporters+xml; charset=utf-8`.
    ELSE.
      zcl_osd_adt_host=>require( `CHECKRUN` ).
      zcl_osd_adt_host=>require( `PACKAGE` ).
      lv_body = cl_abap_codepage=>convert_from( is_request-body ).
      rs_response-body = document( lv_body ).
      rs_response-content_type = `application/vnd.sap.adt.checkmessages+xml; charset=utf-8`.
    ENDIF.
    rs_response-status = 200.
  ENDMETHOD.
  METHOD take.
    DATA lv_start TYPE i.
    DATA lv_end TYPE i.
    DATA lv_tail TYPE string.
    CLEAR: ev_value, ev_found.
    IF cv_offset >= strlen( iv_text ).
      RETURN.
    ENDIF.
    lv_tail = substring( val = iv_text off = cv_offset ).
    FIND FIRST OCCURRENCE OF iv_open IN lv_tail MATCH OFFSET lv_start.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_start = lv_start + cv_offset + strlen( iv_open ).
    lv_tail = substring( val = iv_text off = lv_start ).
    FIND FIRST OCCURRENCE OF iv_close IN lv_tail MATCH OFFSET lv_end.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_end = lv_end + lv_start.
    ev_value = substring( val = iv_text off = lv_start len = lv_end - lv_start ).
    cv_offset = lv_end + strlen( iv_close ).
    ev_found = abap_true.
  ENDMETHOD.
  METHOD uri.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    lt_types = zcl_osd_adt_types=>all( ).
    READ TABLE lt_types INTO ls_type WITH KEY type = iv_type.
    IF sy-subrc = 0.
      rv_uri = `/sap/bc/adt/` && ls_type-collection && `/`
        && zcl_osd_adt_uri=>encode_component( to_lower( iv_name ) ).
    ENDIF.
  ENDMETHOD.
  METHOD object.
    DATA ls_object TYPE zcl_osd_adt_types=>ty_object.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    ls_object = zcl_osd_adt_types=>object_from_uri( iv_uri ).
    IF ls_object-ok = abap_false.
      lx_error = zcx_osd_adt=>internal( `URI malformed` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    IF ls_object-found = abap_true.
      rs_object-type = ls_object-type.
      rs_object-name = ls_object-name.
      rs_object-uri = iv_uri.
      IF iv_canonical = abap_true.
        rs_object-uri = uri( iv_type = rs_object-type iv_name = rs_object-name ).
      ENDIF.
    ENDIF.
  ENDMETHOD.
  METHOD decode_content.
    DATA lv_text TYPE string.
    DATA lv_ws TYPE string.
    DATA lv_off TYPE i.
    DATA lv_end TYPE i.
    DATA lv_char TYPE string.
    DATA lv_alphabet TYPE string VALUE `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/`.
    DATA lv_value TYPE i.
    DATA lv_bits TYPE i.
    DATA lv_buffer TYPE i.
    DATA lv_divisor TYPE i.
    DATA lv_byte TYPE x LENGTH 1.
    DATA lv_bytes TYPE xstring.
    DATA lv_decoded TYPE string.
    DATA lv_pad TYPE i.
    DATA lv_count TYPE i.
    DATA lo_conv TYPE REF TO cl_abap_conv_in_ce.
    lv_ws = ` ` && cl_abap_char_utilities=>newline && cl_abap_char_utilities=>cr_lf
      && cl_abap_char_utilities=>horizontal_tab && cl_abap_char_utilities=>form_feed
      && cl_abap_codepage=>convert_from( '0B' ).
    lv_end = strlen( iv_text ).
    WHILE lv_off < lv_end AND iv_text+lv_off(1) CA lv_ws.
      lv_off = lv_off + 1.
    ENDWHILE.
    WHILE lv_end > lv_off.
      lv_value = lv_end - 1.
      IF iv_text+lv_value(1) NA lv_ws.
        EXIT.
      ENDIF.
      lv_end = lv_end - 1.
    ENDWHILE.
    lv_text = substring( val = iv_text off = lv_off len = lv_end - lv_off ).
    rv_text = lv_text.
    REPLACE ALL OCCURRENCES OF `&lt;` IN rv_text WITH `<`.
    REPLACE ALL OCCURRENCES OF `&gt;` IN rv_text WITH `>`.
    REPLACE ALL OCCURRENCES OF `&quot;` IN rv_text WITH `"`.
    REPLACE ALL OCCURRENCES OF `&apos;` IN rv_text WITH `'`.
    REPLACE ALL OCCURRENCES OF `&amp;` IN rv_text WITH `&`.
    DO strlen( lv_text ) TIMES.
      lv_off = sy-index - 1.
      lv_char = lv_text+lv_off(1).
      IF lv_char = `=`.
        lv_pad = lv_pad + 1.
        IF lv_pad > 2.
          RETURN.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF lv_pad > 0.
        RETURN.
      ENDIF.
      lv_count = lv_count + 1.
      IF lv_char CA lv_ws.
        CONTINUE.
      ENDIF.
      FIND FIRST OCCURRENCE OF lv_char IN lv_alphabet MATCH OFFSET lv_value.
      IF sy-subrc <> 0.
        RETURN.
      ENDIF.
      lv_buffer = lv_buffer * 64 + lv_value.
      lv_bits = lv_bits + 6.
      IF lv_bits >= 8.
        lv_bits = lv_bits - 8.
        lv_divisor = 2 ** lv_bits.
        lv_byte = lv_buffer DIV lv_divisor.
        CONCATENATE lv_bytes lv_byte INTO lv_bytes IN BYTE MODE.
        lv_buffer = lv_buffer MOD lv_divisor.
      ENDIF.
    ENDDO.
    IF lv_count = 0.
      RETURN.
    ENDIF.
    TRY.
        lo_conv = cl_abap_conv_in_ce=>create( encoding = 'UTF-8' ).
        lo_conv->convert( EXPORTING input = lv_bytes IMPORTING data = lv_decoded ).
        IF lv_decoded CA cl_abap_char_utilities=>cr_lf
            AND lv_decoded NS cl_abap_codepage=>convert_from( 'EFBFBD' ).
          rv_text = lv_decoded.
        ENDIF.
      CATCH cx_sy_conversion_codepage.
        RETURN.
    ENDTRY.
  ENDMETHOD.
  METHOD report.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA lv_filter TYPE string.
    DATA ls_issue TYPE zcl_osd_adt_checkreport=>ty_issue.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    IF is_object-has_source = abap_true.
      lv_filter = `SOURCE`.
    ENDIF.
    ls_answer = zcl_osd_adt_host=>store( iv_command = `CHECKRUN` iv_type = is_object-type
      iv_name = is_object-name iv_include = is_object-include iv_source = is_object-source iv_filter = lv_filter ).
    rs_report-uri = is_object-uri.
    TRY.
        lo_json = zcl_ajson=>parse( ls_answer-json ).
        rs_report-status = lo_json->get_string( `/status` ).
        rs_report-status_text = lo_json->get_string( `/statusText` ).
        rs_report-has_status = lo_json->exists( `/status` ).
        rs_report-has_status_text = lo_json->exists( `/statusText` ).
        lt_members = lo_json->members( `/issues` ).
        LOOP AT lt_members INTO lv_member.
          lv_path = `/issues/` && lv_member.
          CLEAR ls_issue.
          ls_issue-line = lo_json->get( lv_path && `/line` ).
          ls_issue-col = lo_json->get( lv_path && `/column` ).
          ls_issue-severity = lo_json->get_string( lv_path && `/severity` ).
          ls_issue-message = lo_json->get_string( lv_path && `/message` ).
          ls_issue-has_line = abap_true.
          ls_issue-has_col = abap_true.
          ls_issue-has_severity = abap_true.
          APPEND ls_issue TO rs_report-issues.
        ENDLOOP.
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid CHECKRUN answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD document.
    DATA lt_objects TYPE tt_object.
    DATA ls_object TYPE ty_object.
    DATA lt_reports TYPE zcl_osd_adt_checkreport=>tt_report.
    DATA ls_report TYPE zcl_osd_adt_checkreport=>ty_report.
    DATA lv_offset TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_inner_offset TYPE i.
    DATA lv_found TYPE abap_bool.
    DATA lv_attrs TYPE string.
    DATA lv_inner TYPE string.
    DATA lv_tail TYPE string.
    DATA lv_uri TYPE string.
    DATA lv_content TYPE string.
    DATA lv_include TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    WHILE lv_offset < strlen( iv_body ).
      take( EXPORTING iv_text = iv_body iv_open = `<chkrun:checkObject` iv_close = `>`
        IMPORTING ev_value = lv_attrs ev_found = lv_found CHANGING cv_offset = lv_offset ).
      IF lv_found = abap_false.
        EXIT.
      ENDIF.
*     JS word boundary: do not consume checkObjectList as a block.
      IF lv_attrs IS NOT INITIAL AND lv_attrs(1) CA `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_`.
        CONTINUE.
      ENDIF.
      lv_tail = substring( val = iv_body off = lv_offset ).
      FIND FIRST OCCURRENCE OF `</chkrun:checkObject>` IN lv_tail MATCH OFFSET lv_pos.
      IF sy-subrc <> 0.
        EXIT.
      ENDIF.
      lv_pos = lv_pos + lv_offset.
      lv_inner = substring( val = iv_body off = lv_offset len = lv_pos - lv_offset ).
      lv_offset = lv_pos + 21.
      lv_inner_offset = 0.
      take( EXPORTING iv_text = lv_attrs iv_open = `adtcore:uri="` iv_close = `"`
        IMPORTING ev_value = lv_uri ev_found = lv_found CHANGING cv_offset = lv_inner_offset ).
      IF lv_found = abap_false OR lv_uri IS INITIAL.
        CONTINUE.
      ENDIF.
      ls_object = object( lv_uri ).
      IF ls_object-type IS INITIAL.
        CONTINUE.
      ENDIF.
      lv_inner_offset = 0.
      take( EXPORTING iv_text = lv_inner iv_open = `<chkrun:content>` iv_close = `</chkrun:content>`
        IMPORTING ev_value = lv_content ev_found = ls_object-has_source CHANGING cv_offset = lv_inner_offset ).
      IF ls_object-has_source = abap_true.
        ls_object-source = decode_content( lv_content ).
      ENDIF.
      lv_inner_offset = 0.
      take( EXPORTING iv_text = lv_inner iv_open = `chkrun:uri="` iv_close = `"`
        IMPORTING ev_value = lv_uri ev_found = lv_found CHANGING cv_offset = lv_inner_offset ).
      lv_inner_offset = 0.
      take( EXPORTING iv_text = lv_uri iv_open = `/includes/` iv_close = `/`
        IMPORTING ev_value = lv_include ev_found = lv_found CHANGING cv_offset = lv_inner_offset ).
      ls_object-include = lv_include.
      APPEND ls_object TO lt_objects.
    ENDWHILE.
    IF lt_objects IS INITIAL.
      lv_offset = 0.
      DO.
        take( EXPORTING iv_text = iv_body iv_open = `adtcore:uri="` iv_close = `"`
          IMPORTING ev_value = lv_uri ev_found = lv_found CHANGING cv_offset = lv_offset ).
        IF lv_found = abap_false.
          EXIT.
        ENDIF.
        ls_object = object( iv_uri = lv_uri iv_canonical = abap_true ).
        IF ls_object-type IS NOT INITIAL.
          APPEND ls_object TO lt_objects.
        ENDIF.
      ENDDO.
    ENDIF.
    packages( EXPORTING iv_body = iv_body CHANGING ct_objects = lt_objects ct_reports = lt_reports ).
    IF lt_objects IS INITIAL AND lt_reports IS INITIAL.
      lx_error = zcx_osd_adt=>invalid_request( `no check object in the request` ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    LOOP AT lt_objects INTO ls_object.
      ls_report = report( ls_object ).
      APPEND ls_report TO lt_reports.
    ENDLOOP.
    rv_xml = zcl_osd_adt_checkreport=>document( lt_reports ).
  ENDMETHOD.
  METHOD packages.
    DATA lv_offset TYPE i.
    DATA lv_name TYPE string.
    DATA lv_decoded TYPE string.
    DATA lv_found TYPE abap_bool.
    DATA lv_ok TYPE abap_bool.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_input TYPE REF TO zcl_osd_adt_json.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    DATA lv_path TYPE string.
    DATA ls_object TYPE ty_object.
    DATA ls_report TYPE zcl_osd_adt_checkreport=>ty_report.
    lv_offset = 0.
    DO.
      take( EXPORTING iv_text = iv_body iv_open = `adtcore:uri="/sap/bc/adt/packages/` iv_close = `"`
        IMPORTING ev_value = lv_name ev_found = lv_found CHANGING cv_offset = lv_offset ).
      IF lv_found = abap_false.
        EXIT.
      ENDIF.
      IF lv_name IS INITIAL.
        CONTINUE.
      ENDIF.
      zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = lv_name IMPORTING ev_text = lv_decoded ev_ok = lv_ok ).
      IF lv_ok = abap_false.
        lx_error = zcx_osd_adt=>internal( `URI malformed` ).
        RAISE EXCEPTION lx_error.
      ENDIF.
      lv_name = lv_decoded.
      CLEAR ls_report.
      ls_report-uri = uri( iv_type = `DEVC` iv_name = lv_name ).
      TRY.
          CREATE OBJECT lo_input.
          lo_input->add( iv_name = `name` iv_value = lv_name ).
          lo_input->add( iv_name = `mode` iv_value = `raw` ).
          ls_answer = zcl_osd_adt_host=>store( iv_command = `PACKAGE` iv_json = lo_input->document( ) ).
          lo_json = zcl_ajson=>parse( ls_answer-json ).
          lt_members = lo_json->members( `/objects` ).
          LOOP AT lt_members INTO lv_member.
            lv_path = `/objects/` && lv_member.
            CLEAR ls_object.
            ls_object-type = lo_json->get_string( lv_path && `/type` ).
            ls_object-name = lo_json->get_string( lv_path && `/name` ).
            ls_object-uri = uri( iv_type = ls_object-type iv_name = ls_object-name ).
            IF ls_object-uri IS NOT INITIAL.
              APPEND ls_object TO ct_objects.
            ENDIF.
          ENDLOOP.
        CATCH cx_root.
          ls_report-status = `notProcessed`.
          ls_report-status_text = `package ` && lv_name && ` does not exist`.
      ENDTRY.
      APPEND ls_report TO ct_reports.
    ENDDO.
  ENDMETHOD.
ENDCLASS.
