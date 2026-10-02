"! POST <collection>/:name?_action=LOCK|UNLOCK: an editing session takes and
"! gives back an object (ADR 0008, port-map.md section 2, step 8). The
"! router has one row per lockable type (ZCL_OSD_ADT_TYPES=>LOCKABLE).
"!
"! Who holds an object is the lock server's: ENQUEUE_EZOSD_ADT_OBJ in mode
"! X, _SCOPE 1, over (type, name). The lock belongs to the ENQ session of
"! the step, which the host binds to the ADT session when that session is
"! stateful (tools/adt-abap-front.mjs), so it outlives the request and goes
"! with logoff, the session DELETE or expiry. Mode X makes a second LOCK of
"! the same session a refusal with MC 602 (the caller's own lock), which is
"! "you have it already", so one UNLOCK releases it, as in the Node facade.
"! Another owner is MC 601 and sy-msgv1 is its user: the 403 with EU 510.
"!
"! The handle is the session's (the host's LOCK_HANDLE and LOCK_RELEASE):
"! an ADT value, not an ENQ one. The documents are byte-equal to the Node
"! facade's (lockResultDocument, lockedByOtherDocument; Gate 1).
CLASS zcl_osd_adt_lock DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_result_type TYPE string VALUE `com.sap.adt.lock.Result2`.

    CLASS-METHODS lock_result
      IMPORTING iv_handle     TYPE string
      RETURNING VALUE(rv_xml) TYPE string.

    "! the lock result's content type: dataname as the Accept header asks
    "! for it, else the fallback
    CLASS-METHODS as_xml_type
      IMPORTING it_headers     TYPE tihttpnvp
                iv_fallback    TYPE string
      RETURNING VALUE(rv_type) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS lock
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
                is_object          TYPE zcl_osd_adt_host=>ty_object
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    CLASS-METHODS unlock
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    CLASS-METHODS enqueue
      IMPORTING is_object TYPE zcl_osd_adt_host=>ty_object
      RAISING   zcx_osd_adt.
    CLASS-METHODS dequeue
      IMPORTING is_object TYPE zcl_osd_adt_host=>ty_object.
    "! a query field by its exact name, as Express reads req.query; a
    "! header without case
    CLASS-METHODS field
      IMPORTING it_fields      TYPE tihttpnvp
                iv_name        TYPE string
                iv_any_case    TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_lock IMPLEMENTATION.

  METHOD zif_osd_adt_route~handle.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_action TYPE string.
    DATA lv_text TYPE string.
    DATA ls_object TYPE zcl_osd_adt_host=>ty_object.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    lv_type = zcl_osd_adt_types=>type_of_path( is_request-path ).
    READ TABLE is_request-params INTO ls_param WITH KEY name = `name`.
    lv_name = ls_param-value.
    lv_action = field( it_fields = is_request-query iv_name = `_action` ).
    lv_action = to_upper( lv_action ).

    ls_object = zcl_osd_adt_host=>object( iv_type = lv_type iv_name = lv_name ).
    IF ls_object-found = abap_false.
      lv_text = |{ lv_type } { lv_name } does not exist|.
      lx_error = zcx_osd_adt=>not_found( lv_text ).
      RAISE EXCEPTION lx_error.
    ENDIF.

    CASE lv_action.
      WHEN `LOCK`.
        rs_response = lock( is_request = is_request is_object = ls_object ).
      WHEN `UNLOCK`.
        rs_response = unlock( is_request ).
      WHEN OTHERS.
        IF lv_action IS INITIAL.
          lv_action = `(none)`.
        ENDIF.
        lv_text = |unknown action { lv_action }|.
        lx_error = zcx_osd_adt=>invalid_request( lv_text ).
        RAISE EXCEPTION lx_error.
    ENDCASE.
  ENDMETHOD.

  METHOD lock.
    DATA lv_handle TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    rs_response-status = 200.
    rs_response-content_type = as_xml_type( it_headers = is_request-headers iv_fallback = c_result_type ).
*   a library object is not ours to change: the envelope with no handle,
*   which a client reads as "not modifiable" before it tries a write
    IF is_object-writable = abap_false.
      rs_response-body = lock_result( `` ).
      RETURN.
    ENDIF.

    enqueue( is_object ).
    TRY.
        lv_handle = zcl_osd_adt_host=>lock_handle( iv_type = is_object-type iv_name = is_object-name ).
      CATCH zcx_osd_adt INTO lx_error.
*       a lock without a handle is one nobody can write with or give back
        dequeue( is_object ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    rs_response-body = lock_result( lv_handle ).
  ENDMETHOD.

  METHOD unlock.
    DATA ls_object TYPE zcl_osd_adt_host=>ty_object.
    DATA lv_handle TYPE string.

*   a handle the session does not hold is ignored, as UNLOCK always was
    lv_handle = field( it_fields = is_request-query iv_name = `lockHandle` ).
    ls_object = zcl_osd_adt_host=>lock_release( lv_handle ).
    IF ls_object-found = abap_true.
      dequeue( ls_object ).
    ENDIF.
    rs_response-status = 200.
    rs_response-content_type = `text/plain; charset=utf-8`.
  ENDMETHOD.

  METHOD enqueue.
    DATA lv_type TYPE zosd_adt_lock-objtype.
    DATA lv_name TYPE zosd_adt_lock-objname.
    DATA lv_user TYPE string.
    DATA lv_text TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    lv_type = is_object-type.
    lv_name = is_object-name.
    CALL FUNCTION 'ENQUEUE_EZOSD_ADT_OBJ'
      EXPORTING
        mode_zosd_adt_lock = 'X'
        objtype            = lv_type
        objname            = lv_name
        x_objtype          = 'X'
        x_objname          = 'X'
        _scope             = '1'
      EXCEPTIONS
        foreign_lock       = 1
        system_failure     = 2
        OTHERS             = 3.
    CASE sy-subrc.
      WHEN 0.
        RETURN.
      WHEN 1.
*       602: the caller's own lock, taken by an earlier LOCK of this session
        IF sy-msgno = '602'.
          RETURN.
        ENDIF.
        lv_user = sy-msgv1.
        lx_error = zcx_osd_adt=>locked_by_other( iv_user = lv_user iv_object = is_object-name ).
      WHEN OTHERS.
        lv_text = |{ is_object-type } { is_object-name } could not be locked (sy-subrc { sy-subrc })|.
        lx_error = zcx_osd_adt=>internal( lv_text ).
    ENDCASE.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.

  METHOD dequeue.
    DATA lv_type TYPE zosd_adt_lock-objtype.
    DATA lv_name TYPE zosd_adt_lock-objname.

    lv_type = is_object-type.
    lv_name = is_object-name.
    CALL FUNCTION 'DEQUEUE_EZOSD_ADT_OBJ'
      EXPORTING
        mode_zosd_adt_lock = 'X'
        objtype            = lv_type
        objname            = lv_name
        x_objtype          = 'X'
        x_objname          = 'X'
        _scope             = '1'.
  ENDMETHOD.

  METHOD lock_result.
    DATA lv_nl TYPE string.
    lv_nl = cl_abap_char_utilities=>newline.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">` && lv_nl
      && `  <asx:values>` && lv_nl
      && `    <DATA>` && lv_nl
      && `      <LOCK_HANDLE>` && zcl_osd_adt_xml=>esc( iv_handle ) && `</LOCK_HANDLE>` && lv_nl
      && `      <CORRNR/>` && lv_nl
      && `      <CORRUSER/>` && lv_nl
      && `      <CORRTEXT/>` && lv_nl
      && `      <IS_LOCAL>X</IS_LOCAL>` && lv_nl
      && `      <IS_LINK_UP/>` && lv_nl
      && `      <MODIFICATION_SUPPORT>NoModification</MODIFICATION_SUPPORT>` && lv_nl
      && `      <LINK_UP_MODE/>` && lv_nl
      && `      <CORR_LOCKS/>` && lv_nl
      && `      <CORR_CONTENTS/>` && lv_nl
      && `      <SCOPE_MESSAGES/>` && lv_nl
      && `    </DATA>` && lv_nl
      && `  </asx:values>` && lv_nl
      && `</asx:abap>` && lv_nl.
  ENDMETHOD.

  METHOD as_xml_type.
    DATA lv_accept TYPE string.
    DATA lv_name TYPE string.

    lv_accept = field( it_fields = it_headers iv_name = `accept` iv_any_case = abap_true ).
    FIND FIRST OCCURRENCE OF REGEX `dataname=([A-Za-z0-9_.]+)` IN lv_accept SUBMATCHES lv_name.
    IF sy-subrc <> 0.
      lv_name = iv_fallback.
    ENDIF.
    rv_type = |application/vnd.sap.as+xml; charset=utf-8; dataname={ lv_name }|.
  ENDMETHOD.

  METHOD field.
    DATA ls_field TYPE ihttpnvp.
    LOOP AT it_fields INTO ls_field.
      IF ls_field-name = iv_name OR ( iv_any_case = abap_true AND to_lower( ls_field-name ) = to_lower( iv_name ) ).
        rv_value = ls_field-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
