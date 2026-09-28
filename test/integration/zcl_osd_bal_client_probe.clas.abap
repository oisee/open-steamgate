CLASS zcl_osd_bal_client_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_osd_bal_client_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    CONSTANTS lc_handle TYPE zcl_osd_bal_store=>ty_handle
      VALUE '1234567890ABCDEF1234567890ABCDEF'.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.

    IF sy-mandt = '123'.
      TRY.
          DATA(lo_existing) = cl_bali_log_db=>get_instance( )->load_log(
            handle = lc_handle ).
          DATA(lo_filter) = cl_bali_log_filter=>create( ).
          lo_filter->set_descriptor( object = 'ZOSD_CLIENT'
            subobject = 'AUDIT' external_id = 'CLIENT_123' ).
          DATA(lt_logs) = cl_bali_log_db=>get_instance( )->load_logs_via_filter(
            filter = lo_filter ).
          IF lines( lt_logs ) <> 1 OR lo_existing->get_handle( ) <> lc_handle.
            out->write( 'BAL client probe failed: client 123 read mismatch' ).
            RETURN.
          ENDIF.
          out->write( 'BAL client probe: client 123 read succeeded' ).
        CATCH cx_bali_runtime.
          APPEND VALUE #( severity = 'S' text = 'client 123 only' ) TO lt_items.
          TRY.
              zcl_osd_bal_store=>save( iv_object = 'ZOSD_CLIENT'
                iv_subobject = 'AUDIT' iv_external_id = 'CLIENT_123'
                iv_handle = lc_handle it_items = lt_items ).
              COMMIT WORK.
              out->write( 'BAL client probe: client 123 wrote log' ).
            CATCH zcx_osd_bal INTO DATA(lx_save).
              ROLLBACK WORK.
              out->write( |BAL client probe failed: { lx_save->reason }| ).
          ENDTRY.
      ENDTRY.
      RETURN.
    ENDIF.

    IF sy-mandt <> '124'.
      out->write( |BAL client probe failed: unexpected client { sy-mandt }| ).
      RETURN.
    ENDIF.

    DATA(lo_other_filter) = cl_bali_log_filter=>create( ).
    lo_other_filter->set_descriptor( object = 'ZOSD_CLIENT'
      subobject = 'AUDIT' external_id = 'CLIENT_123' ).
    TRY.
        DATA(lt_other_logs) = cl_bali_log_db=>get_instance( )->load_logs_via_filter(
          filter = lo_other_filter ).
        out->write( 'BAL client probe failed: client 124 filter saw client 123 log' ).
        RETURN.
      CATCH cx_bali_runtime INTO DATA(lx_filter).
        IF lx_filter->reason <> 'No log found in the database'.
          out->write( |BAL client probe failed: filter: { lx_filter->reason }| ).
          RETURN.
        ENDIF.
    ENDTRY.

    TRY.
        DATA(lo_other_log) = cl_bali_log_db=>get_instance( )->load_log(
          handle = lc_handle ).
        out->write( 'BAL client probe failed: client 124 loaded client 123 handle' ).
        RETURN.
      CATCH cx_bali_runtime INTO DATA(lx_handle).
        IF lx_handle->reason <> 'No log found in the database'.
          out->write( |BAL client probe failed: handle: { lx_handle->reason }| ).
          RETURN.
        ENDIF.
    ENDTRY.
    out->write( 'BAL client probe: client 124 filter and handle denied' ).
  ENDMETHOD.
ENDCLASS.
