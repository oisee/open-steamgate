"! A test double of ZIF_OSD_ADT_SESSION for the CSRF gate's diff test
"! against Node (test/adt-abap-diff.mjs): the sessions in CLASS-DATA, as
"! the Node Sessions keeps them in a Map, with the rules the gate reads --
"! the context cookie wins over the session cookie, an empty or unknown id
"! opens a new session, one token per session, the header
"! x-sap-adt-sessiontype = stateful marks it. No expiry or
"! ENQ: those are the real implementation's (stoker's half of slice 3).
"! Not for a system: the state is one process's memory.
CLASS zcl_osd_adt_session_mem DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_session.
    CONSTANTS c_session_cookie TYPE string VALUE `SAP_SESSIONID_OSD_001`.
    "! forget every session
    CLASS-METHODS reset.
  PRIVATE SECTION.
    TYPES tt_session TYPE STANDARD TABLE OF zif_osd_adt_session=>ty_session WITH DEFAULT KEY.
    CLASS-DATA gt_sessions TYPE tt_session.
    TYPES: BEGIN OF ty_handle,
             id TYPE string,
             handle TYPE string,
             objtype TYPE string,
             objname TYPE string,
           END OF ty_handle.
    CLASS-DATA gt_handles TYPE STANDARD TABLE OF ty_handle WITH DEFAULT KEY.
    CLASS-METHODS random
      RETURNING VALUE(rv_hex) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_session_mem IMPLEMENTATION.

  METHOD reset.
    CLEAR: gt_sessions, gt_handles.
  ENDMETHOD.

  METHOD random.
    DATA lv_uuid TYPE c LENGTH 32.
    TRY.
        lv_uuid = cl_system_uuid=>create_uuid_c32_static( ).
      CATCH cx_uuid_error.
        CLEAR lv_uuid.
    ENDTRY.
    rv_hex = to_lower( lv_uuid ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~resolve.
    DATA ls_cookie TYPE ihttpnvp.
    DATA lv_context TYPE string.
    DATA lv_session TYPE string.
    DATA lv_id TYPE string.
    FIELD-SYMBOLS <ls_session> TYPE zif_osd_adt_session=>ty_session.

    LOOP AT it_cookies INTO ls_cookie.
      IF ls_cookie-name = zif_osd_adt_session=>c_context_cookie.
        lv_context = ls_cookie-value.
      ELSEIF ls_cookie-name = c_session_cookie.
        lv_session = ls_cookie-value.
      ENDIF.
    ENDLOOP.
    lv_id = lv_context.
    IF lv_id IS INITIAL.
      lv_id = lv_session.
    ENDIF.

    IF lv_id IS NOT INITIAL.
      READ TABLE gt_sessions ASSIGNING <ls_session> WITH KEY id = lv_id.
    ENDIF.
    IF lv_id IS INITIAL OR sy-subrc <> 0.
      APPEND INITIAL LINE TO gt_sessions ASSIGNING <ls_session>.
      <ls_session>-id = random( ).
      <ls_session>-id = <ls_session>-id(24).
      <ls_session>-token = random( ).
      <ls_session>-token = <ls_session>-token(24).
*     the user is not the gate's business: the default one
      <ls_session>-user = `OSD`.
      rs_session = <ls_session>.
      rs_session-fresh = abap_true.
    ELSE.
      rs_session = <ls_session>.
      rs_session-fresh = abap_false.
    ENDIF.

    IF to_lower( zcl_osd_adt_csrf=>header( it_headers = it_headers
                                           iv_name    = `x-sap-adt-sessiontype` ) ) = `stateful`.
      <ls_session>-stateful = abap_true.
      rs_session-stateful = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_session~cookies.
    IF is_session-fresh = abap_false AND is_session-stateful = abap_false.
      RETURN.
    ENDIF.
    APPEND |{ zif_osd_adt_session=>c_context_cookie }={ is_session-id }; Path=/sap/bc/adt; HttpOnly; SameSite=Strict|
      TO rt_cookies.
    APPEND |{ c_session_cookie }={ is_session-id }; Path=/; HttpOnly; SameSite=Strict| TO rt_cookies.
  ENDMETHOD.

  METHOD zif_osd_adt_session~token_valid.
    DATA ls_session TYPE zif_osd_adt_session=>ty_session.
    READ TABLE gt_sessions INTO ls_session WITH KEY id = iv_id.
    rv_valid = boolc( sy-subrc = 0 AND ls_session-token = iv_token ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~end.
    DELETE gt_sessions WHERE id = iv_id.
    DELETE gt_handles WHERE id = iv_id.
  ENDMETHOD.

  METHOD zif_osd_adt_session~alive.
    READ TABLE gt_sessions TRANSPORTING NO FIELDS WITH KEY id = iv_id.
    rv_alive = boolc( sy-subrc = 0 ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~enq_context_ended.
    DELETE gt_handles WHERE id = iv_id.
  ENDMETHOD.

  METHOD zif_osd_adt_session~adopt_handle.
    DATA ls_handle TYPE ty_handle.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_extra TYPE string.
    READ TABLE gt_sessions TRANSPORTING NO FIELDS WITH KEY id = iv_id.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_type = to_upper( iv_type ).
    lv_name = to_upper( iv_name ).
    READ TABLE gt_handles INTO ls_handle WITH KEY id = iv_id
      objtype = lv_type objname = lv_name.
    IF sy-subrc <> 0.
      ls_handle-id = iv_id.
      lv_extra = random( ).
      ls_handle-handle = random( ) && lv_extra(8).
      ls_handle-objtype = lv_type.
      ls_handle-objname = lv_name.
      APPEND ls_handle TO gt_handles.
    ENDIF.
    rv_handle = ls_handle-handle.
  ENDMETHOD.

  METHOD zif_osd_adt_session~release_handle.
    DATA ls_handle TYPE ty_handle.
    CLEAR: ev_type, ev_name.
    READ TABLE gt_handles INTO ls_handle WITH KEY id = iv_id handle = iv_handle.
    IF sy-subrc = 0.
      ev_type = ls_handle-objtype.
      ev_name = ls_handle-objname.
      DELETE gt_handles WHERE id = iv_id AND handle = iv_handle.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_session~release_object.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    lv_type = to_upper( iv_type ).
    lv_name = to_upper( iv_name ).
    DELETE gt_handles WHERE id = iv_id AND objtype = lv_type AND objname = lv_name.
  ENDMETHOD.

  METHOD zif_osd_adt_session~holds.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    lv_type = to_upper( iv_type ).
    lv_name = to_upper( iv_name ).
    READ TABLE gt_handles TRANSPORTING NO FIELDS WITH KEY id = iv_id handle = iv_handle
      objtype = lv_type objname = lv_name.
    rv_holds = boolc( sy-subrc = 0 ).
  ENDMETHOD.

ENDCLASS.
