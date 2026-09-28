CLASS zcl_osd_bal_persist_read DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    TYPES tt_handle TYPE STANDARD TABLE OF if_bali_log=>ty_handle WITH EMPTY KEY.
ENDCLASS.

CLASS zcl_osd_bal_persist_read IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lt_handles TYPE tt_handle.
    TRY.
        DATA(lo_filter) = cl_bali_log_filter=>create( ).
        lo_filter->set_descriptor( object = 'ZOSD_FLEET'
          subobject = 'AUDIT' ).
        DATA(lt_logs) = cl_bali_log_db=>get_instance( )->load_logs_via_filter(
          filter = lo_filter ).
        IF lines( lt_logs ) <> 3.
          out->write( |BAL read failed: expected 3 logs, got { lines( lt_logs ) }| ).
          RETURN.
        ENDIF.
        LOOP AT lt_logs INTO DATA(lo_log).
          DATA(lv_handle) = lo_log->get_handle( ).
          READ TABLE lt_handles WITH KEY table_line = lv_handle TRANSPORTING NO FIELDS.
          IF sy-subrc = 0.
            out->write( 'BAL read failed: duplicate log handle' ).
            RETURN.
          ENDIF.
          APPEND lv_handle TO lt_handles.
          DATA(lo_loaded) = cl_bali_log_db=>get_instance( )->load_log(
            handle = lv_handle ).
          DATA(lo_header) = lo_loaded->get_header( ).
          DATA(lt_items) = lo_loaded->get_all_items( ).
          IF lines( lt_items ) <> 3 OR lo_header->number_all_items <> 3.
            out->write( |BAL read failed: { lo_header->external_id } has { lines( lt_items ) } items| ).
            RETURN.
          ENDIF.
          READ TABLE lt_items WITH TABLE KEY log_item_number = 1 INTO DATA(ls_start).
          READ TABLE lt_items WITH TABLE KEY log_item_number = 2 INTO DATA(ls_count).
          READ TABLE lt_items WITH TABLE KEY log_item_number = 3 INTO DATA(ls_finish).
          IF ls_start-item->severity <> 'S' OR
              ls_start-item->get_message_text( ) <> 'started' OR
              ls_count-item->severity <> 'I' OR
              ls_count-item->get_message_text( ) <> '6 ships, 20 voyages' OR
              ls_finish-item->get_message_text( ) <> 'finished'.
            out->write( |BAL read failed: message order or text lost for { lo_header->external_id }| ).
            RETURN.
          ENDIF.
          IF lo_header->external_id = 'OSD_RESTART_ERR' AND
              ( ls_finish-item->severity <> 'E' OR lo_header->number_error_items <> 1 ).
            out->write( 'BAL read failed: error severity lost' ).
            RETURN.
          ENDIF.
          out->write( |{ lo_header->external_id }: { lines( lt_items ) } items, final { ls_finish-item->severity }| ).
        ENDLOOP.
      CATCH cx_bali_runtime INTO DATA(lx_bal).
        out->write( |BAL read failed: { lx_bal->reason }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
