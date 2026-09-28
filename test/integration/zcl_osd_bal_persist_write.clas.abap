CLASS zcl_osd_bal_persist_write DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
  PRIVATE SECTION.
    CLASS-METHODS save_one
      IMPORTING iv_external_id TYPE cl_bali_header_setter=>ty_external_id
                iv_final_severity TYPE cl_bali_free_text_setter=>ty_severity
      RETURNING VALUE(rv_handle) TYPE if_bali_log=>ty_handle
      RAISING cx_bali_runtime.
ENDCLASS.

CLASS zcl_osd_bal_persist_write IMPLEMENTATION.
  METHOD save_one.
    DATA(lo_header) = cl_bali_header_setter=>create(
      object = 'ZOSD_FLEET' subobject = 'AUDIT'
      external_id = iv_external_id ).
    DATA(lo_log) = cl_bali_log=>create_with_header( header = lo_header ).
    lo_log->add_item( item = cl_bali_free_text_setter=>create(
      text = 'started' severity = 'S' timestamp = '20260928010203' ) ).
    lo_log->add_item( item = cl_bali_free_text_setter=>create(
      text = '6 ships, 20 voyages' severity = 'I' ) ).
    lo_log->add_item( item = cl_bali_free_text_setter=>create(
      text = 'finished' severity = iv_final_severity ) ).
    cl_bali_log_db=>get_instance( )->save_log( log = lo_log ).
    rv_handle = lo_log->get_handle( ).
  ENDMETHOD.

  METHOD if_oo_adt_classrun~main.
    TRY.
        DATA(lv_one) = save_one( iv_external_id = 'OSD_RESTART_OK1'
          iv_final_severity = 'S' ).
        DATA(lv_two) = save_one( iv_external_id = 'OSD_RESTART_OK2'
          iv_final_severity = 'S' ).
        DATA(lv_error) = save_one( iv_external_id = 'OSD_RESTART_ERR'
          iv_final_severity = 'E' ).
        COMMIT WORK.
        out->write( |Saved 3 BAL logs: { lv_one } { lv_two } { lv_error }| ).
      CATCH cx_bali_runtime INTO DATA(lx_bal).
        ROLLBACK WORK.
        out->write( |BAL save failed: { lx_bal->reason }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
