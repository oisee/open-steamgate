CLASS cl_bali_log DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_log.
    CLASS-METHODS create_with_header
      IMPORTING header TYPE REF TO if_bali_header_setter
      RETURNING VALUE(log) TYPE REF TO if_bali_log
      RAISING cx_bali_runtime.
    METHODS bind_handle
      IMPORTING handle TYPE if_bali_log=>ty_handle.
  PRIVATE SECTION.
    DATA mv_handle TYPE if_bali_log=>ty_handle.
    DATA mi_header TYPE REF TO if_bali_header_setter.
    DATA mt_items TYPE if_bali_log=>ty_item_table.
ENDCLASS.

CLASS cl_bali_log IMPLEMENTATION.
  METHOD create_with_header.
    IF header IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log header is required'.
    ENDIF.
    DATA(lo_log) = NEW cl_bali_log( ).
    lo_log->mi_header = header.
    TRY.
        lo_log->mv_handle = cl_system_uuid=>create_uuid_c32_static( ).
      CATCH cx_uuid_error.
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = 'Could not create a log handle'.
    ENDTRY.
    log = lo_log.
  ENDMETHOD.

  METHOD bind_handle.
    mv_handle = handle.
  ENDMETHOD.

  METHOD if_bali_log~get_handle.
    handle = mv_handle.
  ENDMETHOD.

  METHOD if_bali_log~get_header.
    header = CAST if_bali_header_getter( mi_header ).
  ENDMETHOD.

  METHOD if_bali_log~add_item.
    DATA lo_getter TYPE REF TO if_bali_item_getter.
    IF item IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_bali_runtime
        EXPORTING iv_reason = 'Application log item is required'.
    ENDIF.
    TRY.
        lo_getter = CAST if_bali_item_getter( item ).
      CATCH cx_sy_move_cast_error.
        RAISE EXCEPTION TYPE cx_bali_runtime
          EXPORTING iv_reason = 'Unsupported application log item'.
    ENDTRY.
    DATA(lv_number) = lines( mt_items ) + 1.
    lo_getter->log_item_number = lv_number.
    INSERT VALUE #( log_item_number = lv_number item = lo_getter ) INTO TABLE mt_items.
    mi_header->if_bali_header_getter~number_all_items = lv_number.
    IF lo_getter->severity = 'E'.
      mi_header->if_bali_header_getter~number_error_items =
        mi_header->if_bali_header_getter~number_error_items + 1.
    ENDIF.
  ENDMETHOD.

  METHOD if_bali_log~get_all_items.
    item_table = mt_items.
  ENDMETHOD.
ENDCLASS.
