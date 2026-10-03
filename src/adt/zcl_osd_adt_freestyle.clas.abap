CLASS zcl_osd_adt_freestyle DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS sql IMPORTING iv_statement TYPE string iv_limit TYPE string DEFAULT `100`
      iv_check TYPE abap_bool DEFAULT abap_false iv_trim TYPE abap_bool DEFAULT abap_false
      iv_fallback TYPE string OPTIONAL RETURNING VALUE(ro_json) TYPE REF TO zcl_ajson RAISING zcx_osd_adt.
    CLASS-METHODS query IMPORTING is_request TYPE zif_osd_adt_route=>ty_request iv_name TYPE string
      iv_default TYPE string OPTIONAL RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS refuse IMPORTING io_json TYPE REF TO zcl_ajson iv_raw TYPE abap_bool DEFAULT abap_false RAISING zcx_osd_adt.
  PRIVATE SECTION.
    CLASS-METHODS check_report IMPORTING io_json TYPE REF TO zcl_ajson iv_uri TYPE string RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_freestyle IMPLEMENTATION.
  METHOD query.
    DATA ls_pair TYPE ihttpnvp.
    DATA lv_found TYPE abap_bool.
    LOOP AT is_request-query INTO ls_pair WHERE name = iv_name.
      IF lv_found = abap_true.
        rv_value = rv_value && `,`.
      ENDIF.
      rv_value = rv_value && ls_pair-value.
      lv_found = abap_true.
    ENDLOOP.
    IF lv_found = abap_false.
      rv_value = iv_default.
    ENDIF.
  ENDMETHOD.
  METHOD sql.
    DATA lv_json TYPE string.
    DATA lv_command TYPE string.
    DATA lv_error TYPE string.
    DATA lv_answer TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_command = `SQL`.
    IF iv_check = abap_true.
      lv_command = `SQLCHECK`.
    ENDIF.
    zcl_osd_adt_host=>require( `SYSTEM` ).
    lv_json = `{"statement":` && zcl_osd_adt_json=>quote( iv_statement )
      && `,"limit":` && zcl_osd_adt_json=>quote( iv_limit )
      && `,"fallback":` && zcl_osd_adt_json=>quote( iv_fallback ).
    IF iv_trim = abap_true.
      lv_json = lv_json && `,"trim":true`.
    ENDIF.
    lv_json = lv_json && `}`.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `SYSTEM` iv_type = lv_command iv_json = lv_json
      IMPORTING ev_json = lv_answer ev_error = lv_error.
    TRY.
        ro_json = zcl_ajson=>parse( lv_answer ).
        IF ro_json->exists( `/error` ) = abap_true AND ro_json->exists( `/code` ) = abap_false.
          zcl_osd_adt_host=>check_error( iv_json = lv_answer iv_error = lv_error ).
        ENDIF.
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid SQL answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD refuse.
    DATA lv_message TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    IF io_json->exists( `/error` ) = abap_false.
      RETURN.
    ENDIF.
    lv_message = io_json->get_string( `/message` ).
    IF iv_raw = abap_true.
      lv_message = io_json->get_string( `/rawMessage` ).
    ENDIF.
    IF io_json->get_string( `/code` ) = `NOT_BUILT`.
      lx_error = zcx_osd_adt=>no_access( iv_message = lv_message iv_status = 503 ).
    ELSE.
      IF iv_raw = abap_false AND lv_message IS INITIAL.
        lv_message = `the statement was refused: ` && io_json->get_string( `/statement` ).
      ENDIF.
      lx_error = zcx_osd_adt=>wrong_data( lv_message ).
    ENDIF.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD check_report.
    DATA lt_reports TYPE zcl_osd_adt_checkreport=>tt_report.
    DATA ls_report TYPE zcl_osd_adt_checkreport=>ty_report.
    DATA ls_issue TYPE zcl_osd_adt_checkreport=>ty_issue.
    DATA lv_code TYPE string.
    ls_report-uri = iv_uri.
    IF io_json->exists( `/error` ) = abap_false.
      ls_report-status_text = `processed`.
    ELSE.
      lv_code = io_json->get_string( `/code` ).
      ls_issue-message = io_json->get_string( `/message` ).
      IF ls_issue-message IS INITIAL.
        ls_issue-message = `SQL syntax check failed`.
      ENDIF.
      IF lv_code = `NOT_BUILT` OR lv_code = `NOT_SERVING` OR lv_code = `CHECK_UNAVAILABLE`.
        ls_report-status = `notProcessed`.
        ls_report-status_text = ls_issue-message.
      ELSE.
        APPEND ls_issue TO ls_report-issues.
      ENDIF.
    ENDIF.
    APPEND ls_report TO lt_reports.
    rv_xml = zcl_osd_adt_checkreport=>document( it_reports = lt_reports iv_omit_empty_list = abap_true ).
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_statement TYPE string.
    DATA lv_action TYPE string.
    DATA lv_uri TYPE string.
    DATA lo_json TYPE REF TO zcl_ajson.
    lv_statement = cl_abap_codepage=>convert_from( is_request-body ).
    lv_action = query( is_request = is_request iv_name = `action` ).
    rs_response-status = 200.
    IF lv_action = `checkSyntax`.
      lv_uri = query( is_request = is_request iv_name = `uniqueURI` iv_default = `/sap/bc/adt/datapreview/freestyle/sqlconsole0` ).
      lo_json = sql( iv_statement = lv_statement iv_check = abap_true ).
      rs_response-content_type = `application/vnd.sap.adt.checkmessages+xml; charset=utf-8`.
      rs_response-body = check_report( io_json = lo_json iv_uri = lv_uri ).
    ELSE.
      lo_json = sql( iv_statement = lv_statement iv_limit = query( is_request = is_request iv_name = `rowNumber` iv_default = `100` ) ).
      refuse( io_json = lo_json iv_raw = abap_true ).
      rs_response-content_type = `application/xml; charset=utf-8`.
      rs_response-body = zcl_osd_adt_tabledata=>document( lo_json ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
