"! What the ADT facade asks the host, through the one host seam there is:
"! ZOSD_STORE DESTINATION 'STORE' (tools/osd-store-destination.mjs,
"! docs/adt-abap-port/port-map.md section 3). No second destination.
"!
"! Slice 1 asks one thing, SYSTEM with the kind IDENTITY: who this system
"! says it is to an ADT client. The id is the one system id, the same as
"! sy-sysid (tools/osd-identity.mjs: OSD_SID, default OSD); the client is
"! the ADT client 001 and not sy-mandt. It stays the host's to answer, per
"! facade instance, because a facade may be started with its own identity.
"! On a system there is no STORE destination; the call then fails and the
"! route answers the failure as a 500 rather than inventing an identity.
"!
"! Slice 2 asks three more things for the lock route:
"!   - OBJECT, a store command: does the object exist, under which name,
"!     and is it ours to change (a library object is not);
"!   - SYSTEM LOCK_HANDLE: the editing session's handle for an object it has
"!     just locked, the one it already has or a new one;
"!   - SYSTEM LOCK_RELEASE: forget a handle, answering the object it named;
"!   - SYSTEM SESSION: whether the request's session asked for state;
"!   - SYSTEM LOCK_HOLDER: whether an object's holder is a live session.
"! The two SYSTEM kinds are the session's handle map, which is still the
"! Node session's in slice 2 (docs/adt-abap-port/abap-skeleton.md, "Slice
"! 2"). Who holds an object is not asked: that is ENQUEUE_EZOSD_ADT_OBJ.
CLASS zcl_osd_adt_host DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_identity,
             system_id      TYPE string,
             user_name      TYPE string,
             user_full_name TYPE string,
             client         TYPE string,
             language       TYPE string,
           END OF ty_identity.

    TYPES: BEGIN OF ty_object,
             found    TYPE abap_bool,
             type     TYPE string,
             name     TYPE string,
             writable TYPE abap_bool,
           END OF ty_object.

    "! one SYSTEM kind, answered as the host's JSON text
    CLASS-METHODS system
      IMPORTING iv_kind        TYPE string
                iv_name        TYPE string OPTIONAL
      RETURNING VALUE(rv_json) TYPE string
      RAISING   zcx_osd_adt.

    CLASS-METHODS object
      IMPORTING iv_type          TYPE string
                iv_name          TYPE string
      RETURNING VALUE(rs_object) TYPE ty_object
      RAISING   zcx_osd_adt.

    CLASS-METHODS lock_handle
      IMPORTING iv_type          TYPE string
                iv_name          TYPE string
      RETURNING VALUE(rv_handle) TYPE string
      RAISING   zcx_osd_adt.

    "! the request's session asked for state (SYSTEM SESSION)
    CLASS-METHODS session_stateful
      RETURNING VALUE(rv_stateful) TYPE abap_bool
      RAISING   zcx_osd_adt.

    "! whether the holder of an object is a live session (SYSTEM
    "! LOCK_HOLDER); asking ends a holder whose session the host knows is gone
    CLASS-METHODS holder_alive
      IMPORTING iv_type         TYPE string
                iv_name         TYPE string
      RETURNING VALUE(rv_alive) TYPE abap_bool
      RAISING   zcx_osd_adt.

    "! the object the handle named (initial type: the session had no such
    "! handle, which is not an error)
    CLASS-METHODS lock_release
      IMPORTING iv_handle        TYPE string
      RETURNING VALUE(rs_object) TYPE ty_object
      RAISING   zcx_osd_adt.

    CLASS-METHODS identity
      RETURNING VALUE(rs_identity) TYPE ty_identity
      RAISING   zcx_osd_adt.
  PRIVATE SECTION.
    CLASS-METHODS parse
      IMPORTING iv_what        TYPE string
                iv_json        TYPE string
      RETURNING VALUE(ro_json) TYPE REF TO zcl_ajson
      RAISING   zcx_osd_adt.
ENDCLASS.

CLASS zcl_osd_adt_host IMPLEMENTATION.

  METHOD system.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `SYSTEM`
                iv_type    = iv_kind
                iv_name    = iv_name
      IMPORTING ev_json    = rv_json
                ev_error   = lv_error
      EXCEPTIONS
                system_failure        = 1 MESSAGE lv_msg
                communication_failure = 2 MESSAGE lv_msg
                OTHERS                = 3.
    IF sy-subrc <> 0.
      lv_error = |no host here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      lv_error = |SYSTEM { iv_kind }: { lv_error }|.
      lx_error = zcx_osd_adt=>internal( lv_error ).
      RAISE EXCEPTION lx_error.
    ENDIF.
  ENDMETHOD.

  METHOD object.
    DATA lv_json TYPE string.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `OBJECT`
                iv_type    = iv_type
                iv_name    = iv_name
      IMPORTING ev_json    = lv_json
                ev_error   = lv_error
      EXCEPTIONS
                system_failure        = 1 MESSAGE lv_msg
                communication_failure = 2 MESSAGE lv_msg
                OTHERS                = 3.
    IF sy-subrc <> 0.
      lv_error = |no host here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      lv_error = |OBJECT { iv_type } { iv_name }: { lv_error }|.
      lx_error = zcx_osd_adt=>internal( lv_error ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    lo_json = parse( iv_what = `OBJECT` iv_json = lv_json ).
    rs_object-found = lo_json->get_boolean( `/found` ).
    rs_object-type = lo_json->get_string( `/type` ).
    rs_object-name = lo_json->get_string( `/name` ).
    rs_object-writable = lo_json->get_boolean( `/writable` ).
  ENDMETHOD.

  METHOD lock_handle.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_object TYPE string.
    DATA lv_json TYPE string.
    lv_object = iv_type && ` ` && iv_name.
    lv_json = system( iv_kind = `LOCK_HANDLE` iv_name = lv_object ).
    lo_json = parse( iv_what = `SYSTEM LOCK_HANDLE` iv_json = lv_json ).
    rv_handle = lo_json->get_string( `/handle` ).
  ENDMETHOD.

  METHOD session_stateful.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_json TYPE string.
    lv_json = system( `SESSION` ).
    lo_json = parse( iv_what = `SYSTEM SESSION` iv_json = lv_json ).
    rv_stateful = lo_json->get_boolean( `/stateful` ).
  ENDMETHOD.

  METHOD holder_alive.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_object TYPE string.
    DATA lv_json TYPE string.
    lv_object = iv_type && ` ` && iv_name.
    lv_json = system( iv_kind = `LOCK_HOLDER` iv_name = lv_object ).
    lo_json = parse( iv_what = `SYSTEM LOCK_HOLDER` iv_json = lv_json ).
    rv_alive = lo_json->get_boolean( `/alive` ).
  ENDMETHOD.

  METHOD lock_release.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_json TYPE string.
    lv_json = system( iv_kind = `LOCK_RELEASE` iv_name = iv_handle ).
    lo_json = parse( iv_what = `SYSTEM LOCK_RELEASE` iv_json = lv_json ).
    rs_object-type = lo_json->get_string( `/type` ).
    rs_object-name = lo_json->get_string( `/name` ).
    rs_object-found = boolc( rs_object-type IS NOT INITIAL ).
  ENDMETHOD.

  METHOD parse.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lv_text TYPE string.
    TRY.
        ro_json = zcl_ajson=>parse( iv_json ).
      CATCH zcx_ajson_error INTO lx_json.
        lv_text = |{ iv_what } is not JSON: { lx_json->get_text( ) }|.
        lx_error = zcx_osd_adt=>internal( lv_text ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.

  METHOD identity.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_json TYPE string.

    lv_json = system( `IDENTITY` ).
    lo_json = parse( iv_what = `SYSTEM IDENTITY` iv_json = lv_json ).
    rs_identity-system_id = lo_json->get_string( `/systemID` ).
    rs_identity-user_name = lo_json->get_string( `/userName` ).
    rs_identity-user_full_name = lo_json->get_string( `/userFullName` ).
    rs_identity-client = lo_json->get_string( `/client` ).
    rs_identity-language = lo_json->get_string( `/language` ).
  ENDMETHOD.

ENDCLASS.
