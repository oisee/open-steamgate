CLASS ltcl_store DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS.
  PRIVATE SECTION.
    METHODS committed_log_and_items FOR TESTING RAISING cx_static_check.
    METHODS rollback_removes_log FOR TESTING RAISING cx_static_check.
    METHODS repeated_external_id FOR TESTING RAISING cx_static_check.
    METHODS public_api_rollback FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_store IMPLEMENTATION.
  METHOD committed_log_and_items.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.
    DATA ls_header TYPE zosd_bal_hdr.
    DATA lt_saved TYPE zcl_osd_bal_store=>tt_persisted_item.
    DATA lv_external TYPE zcl_osd_bal_store=>ty_external_id.
    lv_external = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND VALUE #( severity = 'S' text = 'started' ) TO lt_items.
    APPEND VALUE #( severity = 'E' text = 'finished' ) TO lt_items.

    DATA(lv_handle) = zcl_osd_bal_store=>save(
      iv_object = 'ZOSD_FLEET' iv_subobject = 'AUDIT'
      iv_external_id = lv_external it_items = lt_items ).
    COMMIT WORK.
    zcl_osd_bal_store=>load(
      EXPORTING iv_handle = lv_handle
      IMPORTING es_header = ls_header et_items = lt_saved ).
    cl_abap_unit_assert=>assert_equals( act = ls_header-external_id exp = lv_external ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_saved ) exp = 2 ).
    READ TABLE lt_saved INDEX 2 INTO DATA(ls_second).
    cl_abap_unit_assert=>assert_equals( act = ls_second-severity exp = 'E' ).
    cl_abap_unit_assert=>assert_equals( act = ls_second-message_text exp = 'finished' ).
  ENDMETHOD.

  METHOD rollback_removes_log.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.
    DATA lv_external TYPE zcl_osd_bal_store=>ty_external_id.
    lv_external = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND VALUE #( severity = 'S' text = 'rolled back' ) TO lt_items.
    DATA(lv_handle) = zcl_osd_bal_store=>save( iv_object = 'ZOSD_FLEET'
      iv_subobject = 'AUDIT' iv_external_id = lv_external it_items = lt_items ).
    ROLLBACK WORK.

    TRY.
        DATA(lt_logs) = zcl_osd_bal_store=>find( iv_object = 'ZOSD_FLEET'
          iv_subobject = 'AUDIT' iv_external_id = lv_external ).
        cl_abap_unit_assert=>fail( 'Rollback left a visible application log' ).
      CATCH zcx_osd_bal INTO DATA(lx_bal).
        cl_abap_unit_assert=>assert_equals(
          act = lx_bal->reason exp = 'No log found in the database' ).
    ENDTRY.
  ENDMETHOD.

  METHOD repeated_external_id.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.
    DATA lv_external TYPE zcl_osd_bal_store=>ty_external_id.
    lv_external = cl_system_uuid=>create_uuid_c32_static( ).
    APPEND VALUE #( severity = 'I' text = 'same external ID' ) TO lt_items.
    DATA(lv_first) = zcl_osd_bal_store=>save( iv_object = 'ZOSD_FLEET'
      iv_subobject = 'AUDIT' iv_external_id = lv_external it_items = lt_items ).
    DATA(lv_second) = zcl_osd_bal_store=>save( iv_object = 'ZOSD_FLEET'
      iv_subobject = 'AUDIT' iv_external_id = lv_external it_items = lt_items ).
    COMMIT WORK.
    cl_abap_unit_assert=>assert_differs( act = lv_first exp = lv_second ).
    DATA(lt_logs) = zcl_osd_bal_store=>find( iv_object = 'ZOSD_FLEET'
      iv_subobject = 'AUDIT' iv_external_id = lv_external ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_logs ) exp = 2 ).
  ENDMETHOD.

  METHOD public_api_rollback.
    DATA lv_external TYPE cl_bali_header_setter=>ty_external_id.
    lv_external = cl_system_uuid=>create_uuid_c32_static( ).
    DATA(lo_header) = cl_bali_header_setter=>create(
      object = 'ZOSD_FLEET' subobject = 'AUDIT'
      external_id = lv_external ).
    DATA(lo_log) = cl_bali_log=>create_with_header( header = lo_header ).
    lo_log->add_item( item = cl_bali_free_text_setter=>create(
      text = 'rolled back' severity = 'I' ) ).
    cl_bali_log_db=>get_instance( )->save_log( log = lo_log ).
    ROLLBACK WORK.

    DATA(lo_filter) = cl_bali_log_filter=>create( ).
    lo_filter->set_descriptor( object = 'ZOSD_FLEET'
      subobject = 'AUDIT' external_id = lv_external ).
    TRY.
        DATA(lt_logs) = cl_bali_log_db=>get_instance( )->load_logs_via_filter(
          filter = lo_filter ).
        cl_abap_unit_assert=>fail( 'Rollback left a visible application log' ).
      CATCH cx_bali_runtime INTO DATA(lx_bal).
        cl_abap_unit_assert=>assert_equals(
          act = lx_bal->reason exp = 'No log found in the database' ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
