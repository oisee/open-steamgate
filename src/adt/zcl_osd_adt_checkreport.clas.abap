"! checkReportDocument, including SQL Console's omitted clean list.
CLASS zcl_osd_adt_checkreport DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_issue,
             uri TYPE string,
             line TYPE string,
             col TYPE string,
             severity TYPE string,
             message TYPE string,
             has_line TYPE abap_bool,
             has_col TYPE abap_bool,
             has_severity TYPE abap_bool,
           END OF ty_issue.
    TYPES tt_issue TYPE STANDARD TABLE OF ty_issue WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_report,
             uri TYPE string,
             status TYPE string,
             status_text TYPE string,
             has_status TYPE abap_bool,
             has_status_text TYPE abap_bool,
             issues TYPE tt_issue,
           END OF ty_report.
    TYPES tt_report TYPE STANDARD TABLE OF ty_report WITH DEFAULT KEY.
    CLASS-METHODS document IMPORTING it_reports TYPE tt_report iv_omit_empty_list TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_xml) TYPE string.
ENDCLASS.
CLASS zcl_osd_adt_checkreport IMPLEMENTATION.
  METHOD document.
    DATA lv_nl TYPE string.
    DATA lv_status TYPE string.
    DATA lv_text TYPE string.
    DATA lv_line TYPE string.
    DATA lv_col TYPE string.
    DATA lv_severity TYPE string.
    DATA lv_attrs TYPE string.
    DATA lv_uri TYPE string.
    DATA lv_count TYPE string.
    DATA ls_report TYPE ty_report.
    DATA ls_issue TYPE ty_issue.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun">` && lv_nl.
    LOOP AT it_reports INTO ls_report.
      IF sy-tabix > 1.
        rv_xml = rv_xml && lv_nl.
      ENDIF.
      lv_status = ls_report-status.
      IF ls_report-has_status = abap_false AND lv_status IS INITIAL.
        lv_status = `processed`.
      ENDIF.
      lv_text = ls_report-status_text.
      IF ls_report-has_status_text = abap_false AND lv_text IS INITIAL.
        IF ls_report-issues IS INITIAL.
          lv_text = `no errors`.
        ELSE.
          lv_count = lines( ls_report-issues ).
          CONDENSE lv_count NO-GAPS.
          lv_text = lv_count && ` error(s)`.
        ENDIF.
      ENDIF.
      lv_attrs = `chkrun:reporter="abapCheckRun" chkrun:triggeringUri="`
        && zcl_osd_adt_xml=>esc( ls_report-uri ) && `" chkrun:status="`
        && zcl_osd_adt_xml=>esc( lv_status ) && `" chkrun:statusText="`
        && zcl_osd_adt_xml=>esc( lv_text ) && `"`.
      rv_xml = rv_xml && `  <chkrun:checkReport ` && lv_attrs.
      IF iv_omit_empty_list = abap_true AND ls_report-issues IS INITIAL.
        rv_xml = rv_xml && `/>`.
        CONTINUE.
      ENDIF.
      rv_xml = rv_xml && `>` && lv_nl && `    <chkrun:checkMessageList>` && lv_nl.
      LOOP AT ls_report-issues INTO ls_issue.
        IF sy-tabix > 1.
          rv_xml = rv_xml && lv_nl.
        ENDIF.
        lv_line = ls_issue-line.
        lv_col = ls_issue-col.
        lv_severity = ls_issue-severity.
        IF lv_line IS INITIAL AND ls_issue-has_line = abap_false.
          lv_line = `1`.
        ENDIF.
        IF lv_col IS INITIAL AND ls_issue-has_col = abap_false.
          lv_col = `1`.
        ENDIF.
        IF lv_severity IS INITIAL AND ls_issue-has_severity = abap_false.
          lv_severity = `E`.
        ENDIF.
        lv_uri = ls_issue-uri.
        IF lv_uri IS INITIAL.
          lv_uri = ls_report-uri.
        ENDIF.
        rv_xml = rv_xml && `      <chkrun:checkMessage chkrun:uri="`
          && zcl_osd_adt_xml=>esc( lv_uri ) && `#start=` && lv_line && `,` && lv_col
          && `" chkrun:type="` && zcl_osd_adt_xml=>esc( lv_severity )
          && `" chkrun:shortText="` && zcl_osd_adt_xml=>esc( ls_issue-message ) && `"/>`.
      ENDLOOP.
      rv_xml = rv_xml && lv_nl && `    </chkrun:checkMessageList>` && lv_nl && `  </chkrun:checkReport>`.
    ENDLOOP.
    rv_xml = rv_xml && lv_nl && `</chkrun:checkRunReports>` && lv_nl.
  ENDMETHOD.
ENDCLASS.
