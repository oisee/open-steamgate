CLASS zcl_osd_lift_r2_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
* R2 moves a SELECT INTO TABLE out of a row loop, then rebuilds that table
* at the old statement position so the body keeps its selected rows and order.
  PUBLIC SECTION.
    TYPES:
      BEGIN OF ty_hit,
        label TYPE c LENGTH 40,
      END OF ty_hit,
      tt_hits TYPE STANDARD TABLE OF ty_hit WITH DEFAULT KEY,
      BEGIN OF ty_row,
        kind TYPE c LENGTH 4,
        code TYPE c LENGTH 10,
        result TYPE c LENGTH 100,
        status TYPE i,
        db_count TYPE i,
      END OF ty_row,
      tt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.

    CLASS-METHODS before CHANGING ct_rows TYPE tt_rows.
    CLASS-METHODS after CHANGING ct_rows TYPE tt_rows.
ENDCLASS.

CLASS zcl_osd_lift_r2_demo IMPLEMENTATION.

  METHOD before.
    DATA lt_hits TYPE tt_hits.
    DATA ls_hit TYPE ty_hit.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
    LOOP AT ct_rows ASSIGNING <ls_row>.
      CLEAR <ls_row>-result.
      SELECT label FROM zosd_lift_r2 INTO TABLE lt_hits
        WHERE kind = <ls_row>-kind AND code = <ls_row>-code AND active = 'X'
        ORDER BY PRIMARY KEY.
      MOVE sy-subrc TO <ls_row>-status.
      MOVE sy-dbcnt TO <ls_row>-db_count.
      LOOP AT lt_hits INTO ls_hit.
        IF <ls_row>-result IS INITIAL.
          <ls_row>-result = ls_hit-label.
        ELSE.
          CONCATENATE <ls_row>-result ls_hit-label INTO <ls_row>-result SEPARATED BY ';'.
        ENDIF.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD after.
    DATA lt_hits TYPE tt_hits.
    DATA ls_hit TYPE ty_hit.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
    " osd:gen r2-select-table-per-row from=before begin
    DATA lt_all TYPE STANDARD TABLE OF zosd_lift_r2 WITH DEFAULT KEY.
    FIELD-SYMBOLS <ls_all> LIKE LINE OF lt_all.
    DATA ls_lift_r2 LIKE LINE OF lt_hits.
    DATA lv_lift_saved_subrc TYPE i.
    DATA lv_lift_saved_dbcnt TYPE i.
    DATA lv_lift_saved_tabix TYPE i.
    lv_lift_saved_subrc = sy-subrc.
    lv_lift_saved_dbcnt = sy-dbcnt.
    IF ct_rows IS NOT INITIAL.
      SELECT kind code seq label FROM zosd_lift_r2
        INTO CORRESPONDING FIELDS OF TABLE lt_all
        FOR ALL ENTRIES IN ct_rows
        WHERE kind = ct_rows-kind AND code = ct_rows-code AND active = 'X'.
    ENDIF.
    SORT lt_all BY kind code seq.
    sy-subrc = lv_lift_saved_subrc.
    sy-dbcnt = lv_lift_saved_dbcnt.
    LOOP AT ct_rows ASSIGNING <ls_row>.
      CLEAR <ls_row>-result.
      lv_lift_saved_tabix = sy-tabix.
      CLEAR lt_hits.
      LOOP AT lt_all ASSIGNING <ls_all> WHERE kind = <ls_row>-kind AND code = <ls_row>-code.
        CLEAR ls_lift_r2.
        ls_lift_r2-label = <ls_all>-label.
        APPEND ls_lift_r2 TO lt_hits.
      ENDLOOP.
      IF lt_hits IS INITIAL.
        sy-subrc = 4.
      ELSE.
        sy-subrc = 0.
      ENDIF.
      sy-dbcnt = lines( lt_hits ).
      sy-tabix = lv_lift_saved_tabix.
      MOVE sy-subrc TO <ls_row>-status.
      MOVE sy-dbcnt TO <ls_row>-db_count.
      LOOP AT lt_hits INTO ls_hit.
        IF <ls_row>-result IS INITIAL.
          <ls_row>-result = ls_hit-label.
        ELSE.
          CONCATENATE <ls_row>-result ls_hit-label INTO <ls_row>-result SEPARATED BY ';'.
        ENDIF.
      ENDLOOP.
    ENDLOOP.
    " osd:gen r2-select-table-per-row end
  ENDMETHOD.

ENDCLASS.
