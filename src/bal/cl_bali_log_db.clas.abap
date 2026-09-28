CLASS cl_bali_log_db DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_log_db.
    CLASS-METHODS get_instance
      RETURNING VALUE(db_handler) TYPE REF TO if_bali_log_db.
ENDCLASS.

CLASS cl_bali_log_db IMPLEMENTATION.
  METHOD get_instance.
    db_handler = NEW cl_bali_log_db( ).
  ENDMETHOD.

  METHOD if_bali_log_db~save_log.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.
    IF use_2nd_db_connection = abap_true OR assign_to_current_appl_job = abap_true.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Second connection and job assignment are not supported'.
    ENDIF.
    IF log IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log is required'.
    ENDIF.
    DATA(lo_header) = log->get_header( ).
    IF lo_header IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log header is required'.
    ENDIF.
    DATA(lt_entries) = log->get_all_items( ).
    LOOP AT lt_entries INTO DATA(ls_entry).
      IF ls_entry-item IS NOT BOUND.
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = 'Application log item is required'.
      ENDIF.
      APPEND VALUE #(
        severity = ls_entry-item->severity
        text = ls_entry-item->get_message_text( ) ) TO lt_items.
    ENDLOOP.
    TRY.
        DATA(lv_handle) = zcl_osd_bal_store=>save(
          iv_object = lo_header->object
          iv_subobject = lo_header->subobject
          iv_external_id = lo_header->external_id
          iv_handle = log->get_handle( )
          it_items = lt_items ).
      CATCH zcx_osd_bal INTO DATA(lx_store).
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = lx_store->reason.
    ENDTRY.
  ENDMETHOD.

  METHOD if_bali_log_db~save_log_2nd_db_connection.
    RAISE EXCEPTION TYPE cx_bali_runtime
      EXPORTING iv_reason = 'Second database connection is not supported'.
  ENDMETHOD.

  METHOD if_bali_log_db~load_log.
    DATA ls_header TYPE zosd_bal_hdr.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_persisted_item.
    TRY.
        zcl_osd_bal_store=>load( EXPORTING iv_handle = handle
          IMPORTING es_header = ls_header et_items = lt_items ).
      CATCH zcx_osd_bal INTO DATA(lx_store).
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = lx_store->reason.
    ENDTRY.
    DATA(lo_header) = cl_bali_header_setter=>create(
      object = ls_header-log_object subobject = ls_header-subobject
      external_id = ls_header-external_id ).
    log = cl_bali_log=>create_with_header( header = lo_header ).
    LOOP AT lt_items INTO DATA(ls_item).
      log->add_item( item = cl_bali_free_text_setter=>create(
        text = CONV string( ls_item-message_text ) severity = ls_item-severity ) ).
    ENDLOOP.
    DATA(lo_concrete) = CAST cl_bali_log( log ).
    lo_concrete->bind_handle( handle = handle ).
  ENDMETHOD.

  METHOD if_bali_log_db~load_logs_via_filter.
    IF filter IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log filter is required'.
    ENDIF.
    TRY.
        DATA(lt_headers) = zcl_osd_bal_store=>find(
          iv_object = filter->object
          iv_subobject = filter->subobject
          iv_external_id = filter->external_id ).
      CATCH zcx_osd_bal INTO DATA(lx_store).
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = lx_store->reason.
    ENDTRY.
    LOOP AT lt_headers INTO DATA(ls_header).
      APPEND me->if_bali_log_db~load_log( handle = ls_header-log_id ) TO log_table.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
