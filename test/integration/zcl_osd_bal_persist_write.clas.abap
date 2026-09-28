CLASS zcl_osd_bal_persist_write DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.

CLASS zcl_osd_bal_persist_write IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lt_items TYPE zcl_osd_bal_store=>tt_item.
    APPEND VALUE #( severity = 'S' text = 'started' ) TO lt_items.
    APPEND VALUE #( severity = 'I' text = '6 ships, 20 voyages' ) TO lt_items.
    APPEND VALUE #( severity = 'S' text = 'finished' ) TO lt_items.
    TRY.
        DATA(lv_one) = zcl_osd_bal_store=>save(
          iv_object = 'ZOSD_FLEET' iv_subobject = 'AUDIT'
          iv_external_id = 'OSD_RESTART_OK1' it_items = lt_items ).
        DATA(lv_two) = zcl_osd_bal_store=>save(
          iv_object = 'ZOSD_FLEET' iv_subobject = 'AUDIT'
          iv_external_id = 'OSD_RESTART_OK2' it_items = lt_items ).
        READ TABLE lt_items INDEX 3 ASSIGNING FIELD-SYMBOL(<ls_finish>).
        <ls_finish>-severity = 'E'.
        DATA(lv_error) = zcl_osd_bal_store=>save(
          iv_object = 'ZOSD_FLEET' iv_subobject = 'AUDIT'
          iv_external_id = 'OSD_RESTART_ERR' it_items = lt_items ).
        COMMIT WORK.
        out->write( |Saved 3 BAL logs: { lv_one } { lv_two } { lv_error }| ).
      CATCH zcx_osd_bal INTO DATA(lx_bal).
        ROLLBACK WORK.
        out->write( |BAL save failed: { lx_bal->reason }| ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
