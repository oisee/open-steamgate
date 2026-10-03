* B2: activation must wait until this entire child step has ended.
CLASS zcl_osd_adt_store_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_osd_adt_store_probe IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main.
    DATA lv_note TYPE string.
    DATA lv_error TYPE string.
    DATA lv_json TYPE string.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = 'ACTIVATE' iv_type = 'CLAS'
                iv_name = 'ZCL_OSD_CLASSRUN_DEMO'
      IMPORTING ev_note = lv_note ev_error = lv_error.
    out->write( lv_note ).
    out->write( lv_error ).
* The parent holds this call so the test can inspect publish ordering.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = 'SYSTEM' iv_type = 'BUILD'
      IMPORTING ev_error = lv_error.
    out->write( lv_error ).
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = 'SYSTEM' iv_type = 'SQL'
                iv_json = '{"sql":"SELECT id FROM zosd_adt_sess"}'
      IMPORTING ev_json = lv_json ev_error = lv_error.
    out->write( lv_json ).
    out->write( lv_error ).
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = 'SYSTEM' iv_type = 'XREF'
                iv_json = '{"sql":"SELECT name FROM wbcrossgt","max":1}'
      IMPORTING ev_json = lv_json ev_error = lv_error.
    out->write( lv_json ).
    out->write( lv_error ).
  ENDMETHOD.
ENDCLASS.
