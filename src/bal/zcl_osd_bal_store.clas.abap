CLASS zcl_osd_bal_store DEFINITION PUBLIC FINAL CREATE PUBLIC.
* Internal store for a measured subset of BAL. It never commits its caller's
* LUW; a later CL_BALI_* facade can expose the SAP names and interfaces.
  PUBLIC SECTION.
    TYPES ty_handle TYPE c LENGTH 32.
    TYPES ty_object TYPE c LENGTH 20.
    TYPES ty_subobject TYPE c LENGTH 20.
    TYPES ty_external_id TYPE c LENGTH 100.
    TYPES: BEGIN OF ty_item,
             severity TYPE c LENGTH 1,
             text     TYPE string,
             timestamp TYPE timestamp,
           END OF ty_item.
    TYPES tt_item TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY.
    TYPES tt_header TYPE STANDARD TABLE OF zosd_bal_hdr WITH EMPTY KEY.
    TYPES tt_persisted_item TYPE STANDARD TABLE OF zosd_bal_itm WITH EMPTY KEY.

    CLASS-METHODS save
      IMPORTING iv_object TYPE ty_object
                iv_subobject TYPE ty_subobject
                iv_external_id TYPE ty_external_id
                iv_handle TYPE ty_handle OPTIONAL
                it_items TYPE tt_item
      RETURNING VALUE(rv_handle) TYPE ty_handle
      RAISING zcx_osd_bal.
    CLASS-METHODS find
      IMPORTING iv_object TYPE ty_object
                iv_subobject TYPE ty_subobject OPTIONAL
                iv_external_id TYPE ty_external_id OPTIONAL
      RETURNING VALUE(rt_headers) TYPE tt_header
      RAISING zcx_osd_bal.
    CLASS-METHODS load
      IMPORTING iv_handle TYPE ty_handle
      EXPORTING es_header TYPE zosd_bal_hdr
                et_items TYPE tt_persisted_item
      RAISING zcx_osd_bal.
ENDCLASS.

CLASS zcl_osd_bal_store IMPLEMENTATION.
  METHOD save.
    DATA ls_header TYPE zosd_bal_hdr.
    DATA ls_item TYPE zosd_bal_itm.
    DATA lv_number TYPE i.

    IF iv_object IS INITIAL OR iv_subobject IS INITIAL OR it_items IS INITIAL.
      RAISE EXCEPTION TYPE zcx_osd_bal
        EXPORTING iv_reason = 'Object, subobject and at least one item are required'.
    ENDIF.
    LOOP AT it_items INTO DATA(ls_input).
      IF ls_input-severity NA 'AEIWS' OR ls_input-text IS INITIAL
          OR strlen( ls_input-text ) > 255.
        RAISE EXCEPTION TYPE zcx_osd_bal
          EXPORTING iv_reason = 'Invalid severity or message text'.
      ENDIF.
    ENDLOOP.

    IF iv_handle IS INITIAL.
      TRY.
          rv_handle = cl_system_uuid=>create_uuid_c32_static( ).
        CATCH cx_uuid_error.
          RAISE EXCEPTION TYPE zcx_osd_bal
            EXPORTING iv_reason = 'Could not create a log handle'.
      ENDTRY.
    ELSE.
      rv_handle = iv_handle.
    ENDIF.

    ls_header-mandt = sy-mandt.
    ls_header-log_id = rv_handle.
    ls_header-log_object = iv_object.
    ls_header-subobject = iv_subobject.
    ls_header-external_id = iv_external_id.
    ls_header-created_on = sy-datum.
    ls_header-created_at = sy-uzeit.
    INSERT zosd_bal_hdr FROM ls_header.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_osd_bal
        EXPORTING iv_reason = 'Could not insert application log header'.
    ENDIF.

    LOOP AT it_items INTO ls_input.
      ADD 1 TO lv_number.
      CLEAR ls_item.
      ls_item-mandt = sy-mandt.
      ls_item-log_id = rv_handle.
      ls_item-item_no = lv_number.
      ls_item-severity = ls_input-severity.
      ls_item-message_text = ls_input-text.
      ls_item-created_at = ls_input-timestamp.
      IF ls_item-created_at IS INITIAL.
        GET TIME STAMP FIELD ls_item-created_at.
      ENDIF.
      INSERT zosd_bal_itm FROM ls_item.
      IF sy-subrc <> 0.
* Only lower item numbers were inserted by this call. A failed number may
* already belong to another writer, so leave that row alone.
        DELETE FROM zosd_bal_itm WHERE mandt = sy-mandt AND log_id = rv_handle
          AND item_no < lv_number.
        DELETE FROM zosd_bal_hdr WHERE mandt = sy-mandt AND log_id = rv_handle.
        RAISE EXCEPTION TYPE zcx_osd_bal
          EXPORTING iv_reason = 'Could not insert application log item'.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD find.
    IF iv_object IS INITIAL.
      RAISE EXCEPTION TYPE zcx_osd_bal
        EXPORTING iv_reason = 'Application log object is required'.
    ENDIF.
    IF iv_subobject IS INITIAL AND iv_external_id IS INITIAL.
      SELECT * FROM zosd_bal_hdr INTO TABLE rt_headers
        WHERE mandt = sy-mandt AND log_object = iv_object.
    ELSEIF iv_external_id IS INITIAL.
      SELECT * FROM zosd_bal_hdr INTO TABLE rt_headers
        WHERE mandt = sy-mandt AND log_object = iv_object
          AND subobject = iv_subobject.
    ELSEIF iv_subobject IS INITIAL.
      SELECT * FROM zosd_bal_hdr INTO TABLE rt_headers
        WHERE mandt = sy-mandt AND log_object = iv_object
          AND external_id = iv_external_id.
    ELSE.
      SELECT * FROM zosd_bal_hdr INTO TABLE rt_headers
        WHERE mandt = sy-mandt AND log_object = iv_object AND subobject = iv_subobject
          AND external_id = iv_external_id.
    ENDIF.
    IF rt_headers IS INITIAL.
      RAISE EXCEPTION TYPE zcx_osd_bal
        EXPORTING iv_reason = 'No log found in the database'.
    ENDIF.
    SORT rt_headers BY created_on created_at log_id.
  ENDMETHOD.

  METHOD load.
    SELECT SINGLE * FROM zosd_bal_hdr INTO es_header
      WHERE mandt = sy-mandt AND log_id = iv_handle.
    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE zcx_osd_bal
        EXPORTING iv_reason = 'No log found in the database'.
    ENDIF.
    SELECT * FROM zosd_bal_itm INTO TABLE et_items
      WHERE mandt = sy-mandt AND log_id = iv_handle.
    SORT et_items BY item_no.
  ENDMETHOD.
ENDCLASS.
