"! POST <collection>/:name?_action=LOCK|UNLOCK: an editing session takes and
"! gives back an object (ADR 0008, port-map.md section 2, step 8). The
"! router has one row per lockable type (ZCL_OSD_ADT_TYPES=>LOCKABLE).
"!
"! Who holds an object is the lock server's: ENQUEUE_EZOSD_ADT_OBJ in mode
"! X, _SCOPE 1, over (type, name). The lock belongs to the ENQ session of
"! the step, which the host binds to the ADT session when that session is
"! stateful (tools/adt-abap-front.mjs), so it outlives the request and goes
"! with logoff, the session DELETE or expiry. Mode X makes a second LOCK of
"! the same session a refusal with MC 602 (the caller's own lock). Both it
"! and MC 601 (another owner) answer 403 with EU 510; LOCK is not re-entrant.
"!
"! A lock needs a stateful session: without one the ENQ session is the
"! request's, and the lock would be gone before the client used its handle.
"! Such a LOCK is refused 400 rather than given a dead handle. A holder the
"! host knows is gone (a LOCK of a session queued behind that session's
"! logoff) is ended by asking the host (LOCK_HOLDER) once, then retried.
"!
"! The handle is the session's (the host's LOCK_HANDLE and LOCK_RELEASE):
"! an ADT value, not an ENQ one. The documents are byte-equal to the Node
"! facade's (lockResultDocument, lockedByOtherDocument; Gate 1).
CLASS zcl_osd_adt_lock DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_result_type TYPE string VALUE `com.sap.adt.lock.Result`.

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
    CLASS-METHODS lock_type
      IMPORTING it_headers     TYPE tihttpnvp
      RETURNING VALUE(rv_type) TYPE string
      RAISING zcx_osd_adt.
    CLASS-METHODS lock
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
                is_object          TYPE zcl_osd_adt_host=>ty_object
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    CLASS-METHODS unlock
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    "! ENQUEUE_EZOSD_ADT_OBJ: existing locks, including MC 602, are refused
    CLASS-METHODS enqueue
      IMPORTING is_object         TYPE zcl_osd_adt_host=>ty_object
      RAISING   zcx_osd_adt.
    CLASS-METHODS try_enqueue
      IMPORTING is_object TYPE zcl_osd_adt_host=>ty_object
      EXPORTING ev_subrc  TYPE i
                ev_msgno  TYPE string
                ev_user   TYPE string.
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
    DATA lv_uri TYPE string.
    DATA lv_element TYPE string.
    DATA ls_root TYPE zif_osd_adt_xml=>ty_element.
    DATA lt_properties TYPE tihttpnvp.
    DATA ls_property TYPE ihttpnvp.
    DATA lv_length TYPE i.

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

*   No _action means an object XML write, irrespective of Accept.
    READ TABLE is_request-query WITH KEY name = `_action` TRANSPORTING NO FIELDS.
    IF sy-subrc <> 0.
      CASE lv_type.
        WHEN `CLAS`.
          lv_uri = `http://www.sap.com/adt/oo/classes`.
          lv_element = `abapClass`.
        WHEN `INTF`.
          lv_uri = `http://www.sap.com/adt/oo/interfaces`.
          lv_element = `abapInterface`.
        WHEN `PROG`.
          lv_uri = `http://www.sap.com/adt/programs/programs`.
          lv_element = `abapProgram`.
        WHEN `INCL`.
          lv_uri = `http://www.sap.com/adt/programs/includes`.
          lv_element = `abapInclude`.
        WHEN `DDLS`.
          lv_uri = `http://www.sap.com/adt/ddic/ddlsources`.
          lv_element = `ddlSource`.
        WHEN `SRVD`.
          lv_uri = `http://www.sap.com/adt/ddic/srvd`.
          lv_element = `serviceDefinition`.
      ENDCASE.
      IF lv_element IS NOT INITIAL.
        READ TABLE is_request-xml INDEX 1 INTO ls_root.
        IF ls_root-uri = lv_uri AND ls_root-local = lv_element.
          CREATE OBJECT lx_error EXPORTING iv_status = 501 iv_type = `ExceptionResourceNoAccess`
            iv_message = `object XML updates are not supported here`.
          RAISE EXCEPTION lx_error.
        ENDIF.
        lv_text = |System expected the element '\{{ lv_uri }\}{ lv_element }'|.
        ls_property-name = `XML_PATH`.
        IF ls_root-local IS NOT INITIAL.
          ls_property-value = ls_root-local && `(1)`.
        ENDIF.
        APPEND ls_property TO lt_properties.
        ls_property-name = `XML_OFFSET`.
        lv_length = xstrlen( is_request-body ).
        ls_property-value = |{ lv_length } |.
        APPEND ls_property TO lt_properties.
        ls_property-name = `T100KEY-ID`.
        ls_property-value = `00`.
        APPEND ls_property TO lt_properties.
        ls_property-name = `T100KEY-NO`.
        ls_property-value = `001`.
        APPEND ls_property TO lt_properties.
        ls_property-name = `T100KEY-V1`.
        ls_property-value = substring( val = lv_text len = 48 ).
        APPEND ls_property TO lt_properties.
        ls_property-name = `T100KEY-V2`.
        ls_property-value = substring( val = lv_text off = 48 ).
        APPEND ls_property TO lt_properties.
        CREATE OBJECT lx_error EXPORTING iv_status = 400 iv_type = `ExceptionInvalidData`
          iv_message = lv_text it_properties = lt_properties.
        RAISE EXCEPTION lx_error.
      ENDIF.
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
    DATA lv_text TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    rs_response-status = 200.
*   negotiate before enqueue: SAP's 406 takes a lock without giving a handle
    rs_response-content_type = lock_type( is_request-headers ).
*   a library object is not ours to change: the envelope with no handle,
*   which a client reads as "not modifiable" before it tries a write
    IF is_object-writable = abap_false.
      rs_response-body = lock_result( `` ).
      RETURN.
    ENDIF.

    IF zcl_osd_adt_host=>session_stateful( ) = abap_false.
      lv_text = |{ is_object-type } { is_object-name } cannot be locked outside a stateful session;|
        && ` send x-sap-adt-sessiontype: stateful`.
      lx_error = zcx_osd_adt=>invalid_request( lv_text ).
      RAISE EXCEPTION lx_error.
    ENDIF.

    enqueue( is_object ).
    TRY.
        lv_handle = zcl_osd_adt_host=>lock_handle( iv_type = is_object-type iv_name = is_object-name ).
      CATCH zcx_osd_adt INTO lx_error.
*       a lock without a handle is one nobody can write with or give back,
*       so a lock this call took goes again
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
    DATA lv_subrc TYPE i.
    DATA lv_msgno TYPE string.
    DATA lv_user TYPE string.
    DATA lv_text TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    try_enqueue( EXPORTING is_object = is_object
                 IMPORTING ev_subrc = lv_subrc ev_msgno = lv_msgno ev_user = lv_user ).
*   another owner the host knows is gone is ended by the asking: once more
    IF lv_subrc = 1 AND lv_msgno = `601`
        AND zcl_osd_adt_host=>holder_alive( iv_type = is_object-type iv_name = is_object-name ) = abap_false.
      try_enqueue( EXPORTING is_object = is_object
                   IMPORTING ev_subrc = lv_subrc ev_msgno = lv_msgno ev_user = lv_user ).
    ENDIF.
    CASE lv_subrc.
      WHEN 0.
        RETURN.
      WHEN 1.
*       both another owner's lock and the caller's own lock (MC 602)
        lx_error = zcx_osd_adt=>locked_by_other( iv_user = lv_user iv_object = is_object-name ).
      WHEN OTHERS.
        lv_text = |{ is_object-type } { is_object-name } could not be locked (sy-subrc { lv_subrc })|.
        lx_error = zcx_osd_adt=>internal( lv_text ).
    ENDCASE.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.

  METHOD try_enqueue.
    DATA lv_type TYPE zosd_adt_lock-objtype.
    DATA lv_name TYPE zosd_adt_lock-objname.

    CLEAR: ev_msgno, ev_user.
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
    ev_subrc = sy-subrc.
    IF ev_subrc = 1.
      ev_msgno = sy-msgno.
      ev_user = sy-msgv1.
    ENDIF.
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
      && `      <MODIFICATION_SUPPORT/>` && lv_nl
      && `      <SCOPE_MESSAGES/>` && lv_nl
      && `    </DATA>` && lv_nl
      && `  </asx:values>` && lv_nl
      && `</asx:abap>` && lv_nl.
  ENDMETHOD.

  METHOD as_xml_type.
    rv_type = zcl_osd_adt_xml=>as_xml_type( it_headers = it_headers iv_fallback = iv_fallback ).
  ENDMETHOD.

  METHOD lock_type.
    DATA lv_accept TYPE string.
    DATA lt_offers TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_offer TYPE string.
    DATA lv_media TYPE string.
    DATA lv_params TYPE string.
    DATA lv_ows_pattern TYPE string.
    DATA lv_has_media TYPE abap_bool.
    DATA lt_properties TYPE tihttpnvp.
    DATA ls_property TYPE ihttpnvp.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    rv_type = |application/vnd.sap.as+xml; charset=utf-8; dataname={ c_result_type }|.
    lv_accept = field( it_fields = it_headers iv_name = `accept` iv_any_case = abap_true ).
    IF lv_accept IS INITIAL.
      RETURN.
    ENDIF.
*   HTTP OWS is space or HTAB; trim only the media token's edges.
    lv_ows_pattern = `^[ ` && cl_abap_char_utilities=>horizontal_tab
      && `]+|[ ` && cl_abap_char_utilities=>horizontal_tab && `]+$`.
    SPLIT lv_accept AT `,` INTO TABLE lt_offers.
    LOOP AT lt_offers INTO lv_offer.
      SPLIT lv_offer AT `;` INTO lv_media lv_params.
      REPLACE ALL OCCURRENCES OF REGEX lv_ows_pattern IN lv_media WITH ``.
      IF lv_media IS INITIAL.
        CONTINUE.
      ENDIF.
      lv_has_media = abap_true.
      lv_media = to_lower( lv_media ).
*     Program offers measured 2026-10-04 ignore q and dataname.
*     Media-type case and wildcard acceptance are our policies.
      IF lv_media = `application/vnd.sap.as+xml` OR lv_media = `application/*` OR lv_media = `*/*`.
        RETURN.
      ENDIF.
    ENDLOOP.
*   Our choice: empty list elements alone behave like missing Accept.
    IF lv_has_media = abap_false.
      RETURN.
    ENDIF.
    ls_property-name = `T100KEY-ID`.
    ls_property-value = `SADT_RESOURCE`.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-NO`.
    ls_property-value = `044`.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-V1`.
    ls_property-value = `application/vnd.sap.as+xml`.
    APPEND ls_property TO lt_properties.
    CREATE OBJECT lx_error
      EXPORTING iv_status = 406 iv_type = `ExceptionResourceNotAcceptable`
        iv_message = `The message content is not acceptable. Accepted content types: application/vnd.sap.as+xml`
        it_properties = lt_properties.
    RAISE EXCEPTION lx_error.
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
