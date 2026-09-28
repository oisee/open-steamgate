CLASS ltcl_store DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL DANGEROUS.
  PRIVATE SECTION.
    METHODS committed_log_and_items FOR TESTING RAISING cx_static_check.
    METHODS rollback_removes_log FOR TESTING RAISING cx_static_check.
    METHODS repeated_external_id FOR TESTING RAISING cx_static_check.
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
ENDCLASS.
