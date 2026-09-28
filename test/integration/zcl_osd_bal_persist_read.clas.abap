CLASS zcl_osd_bal_persist_read DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_osd_bal_persist_read IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA ls_header TYPE zosd_bal_hdr.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_persisted_item.
    TRY.
        DATA(lt_logs) = zcl_osd_bal_store=>find( iv_object = 'ZOSD_FLEET'
          iv_subobject = 'AUDIT' ).
        IF lines( lt_logs ) <> 3.
          out->write( |BAL read failed: expected 3 logs, got { lines( lt_logs ) }| ).
          RETURN.
        ENDIF.
        LOOP AT lt_logs INTO DATA(ls_log).
          zcl_osd_bal_store=>load( EXPORTING iv_handle = ls_log-log_id
            IMPORTING es_header = ls_header et_items = lt_items ).
          IF lines( lt_items ) <> 3.
            out->write( |BAL read failed: { ls_log-external_id } has { lines( lt_items ) } items| ).
            RETURN.
          ENDIF.
          READ TABLE lt_items INDEX 3 INTO DATA(ls_finish).
          IF ls_log-external_id = 'OSD_RESTART_ERR' AND ls_finish-severity <> 'E'.
            out->write( 'BAL read failed: error severity lost' ).
            RETURN.
          ENDIF.
          out->write( |{ ls_log-external_id }: { lines( lt_items ) } items, final { ls_finish-severity }| ).
        ENDLOOP.
      CATCH zcx_osd_bal INTO DATA(lx_bal).
        out->write( |BAL read failed: { lx_bal->reason }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
