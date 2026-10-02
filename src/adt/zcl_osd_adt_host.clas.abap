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
             package TYPE string,
             packages TYPE string_table,
             changed_at TYPE string,
             changed_by TYPE string,
             version TYPE string,
             includes TYPE string_table,
           END OF ty_object.

    TYPES: BEGIN OF ty_answer,
             json TYPE string,
             source TYPE string,
           END OF ty_answer.

    "! Refuse commands absent from the host COMMANDS capability list.
    CLASS-METHODS require IMPORTING iv_command TYPE string RAISING zcx_osd_adt.

    "! All host calls share the typed error envelope. SOURCE is a raw body.
    CLASS-METHODS store
      IMPORTING iv_command TYPE string
                iv_type TYPE string OPTIONAL
                iv_name TYPE string OPTIONAL
                iv_include TYPE string OPTIONAL
                iv_json TYPE string OPTIONAL
      RETURNING VALUE(rs_answer) TYPE ty_answer
      RAISING zcx_osd_adt.

    "! Also public for callers that need the older scalar/table parameters.
    CLASS-METHODS check_error
      IMPORTING iv_json TYPE string iv_error TYPE string OPTIONAL
      RAISING zcx_osd_adt.

    "! one SYSTEM kind, answered as the host's JSON text
    CLASS-METHODS system
      IMPORTING iv_kind        TYPE string
                iv_name        TYPE string OPTIONAL
                iv_json        TYPE string OPTIONAL
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

  METHOD require.
    DATA ls_answer TYPE ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_commands TYPE string_table.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    ls_answer = store( `COMMANDS` ).
    TRY.
        lo_json = zcl_ajson=>parse( ls_answer-json ).
        lt_commands = lo_json->array_to_string_table( `/commands` ).
      CATCH zcx_ajson_error.
        lx_error = zcx_osd_adt=>internal( `invalid COMMANDS answer` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    READ TABLE lt_commands WITH KEY table_line = iv_command TRANSPORTING NO FIELDS.
    IF sy-subrc <> 0.
      lx_error = zcx_osd_adt=>not_supported( |unknown store command { iv_command }| ).
      RAISE EXCEPTION lx_error.
    ENDIF.
  ENDMETHOD.

  METHOD store.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = iv_command
                iv_type = iv_type
                iv_name = iv_name
                iv_include = iv_include
                iv_json = iv_json
      IMPORTING ev_json = rs_answer-json
                ev_source = rs_answer-source
                ev_error = lv_error
      EXCEPTIONS system_failure = 1 MESSAGE lv_msg
                 communication_failure = 2 MESSAGE lv_msg
                 OTHERS = 3.
    IF sy-subrc <> 0.
      lx_error = zcx_osd_adt=>internal( |no host here: { lv_msg }| ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    check_error( iv_json = rs_answer-json iv_error = lv_error ).
  ENDMETHOD.

  METHOD check_error.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_code TYPE string.
    DATA lv_message TYPE string.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    IF iv_error IS INITIAL.
      RETURN.
    ENDIF.
    IF iv_json IS NOT INITIAL.
      lo_json = parse( iv_what = `STORE` iv_json = iv_json ).
      lv_code = lo_json->get_string( `/error/code` ).
      lv_message = lo_json->get_string( `/error/message` ).
    ENDIF.
    IF lv_code IS INITIAL.
*     Older hosts only carry EV_ERROR. An absent command is always 501.
      lv_message = iv_error.
      IF iv_error CP `unknown store command *`.
        lv_code = `NOT_SUPPORTED`.
      ENDIF.
    ENDIF.
    CASE lv_code.
      WHEN `NOT_FOUND`.
        lx_error = zcx_osd_adt=>not_found( lv_message ).
      WHEN `CONFLICT`.
        lx_error = zcx_osd_adt=>conflict( lv_message ).
      WHEN `READ_ONLY`.
        lx_error = zcx_osd_adt=>read_only( lv_message ).
      WHEN `NOT_SUPPORTED`.
        lx_error = zcx_osd_adt=>not_supported( lv_message ).
      WHEN `INVALID_NAME`.
        lx_error = zcx_osd_adt=>invalid_request( lv_message ).
      WHEN OTHERS.
        lx_error = zcx_osd_adt=>internal( lv_message ).
    ENDCASE.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.

  METHOD system.
    DATA ls_answer TYPE ty_answer.
    ls_answer = store( iv_command = `SYSTEM` iv_type = iv_kind iv_name = iv_name iv_json = iv_json ).
    IF ls_answer-json IS INITIAL.
      rv_json = ls_answer-source.
    ELSE.
      rv_json = ls_answer-json.
    ENDIF.
  ENDMETHOD.

  METHOD object.
    DATA ls_answer TYPE ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lt_members TYPE string_table.
    DATA lv_member TYPE string.
    ls_answer = store( iv_command = `OBJECT` iv_type = iv_type iv_name = iv_name ).
    lo_json = parse( iv_what = `OBJECT` iv_json = ls_answer-json ).
    rs_object-found = lo_json->get_boolean( `/found` ).
    IF rs_object-found = abap_false.
      RETURN.
    ENDIF.
    rs_object-type = lo_json->get_string( `/type` ).
    rs_object-name = lo_json->get_string( `/name` ).
    rs_object-writable = lo_json->get_boolean( `/writable` ).
    rs_object-package = lo_json->get_string( `/package` ).
    lt_members = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/packages` ).
    LOOP AT lt_members INTO lv_member.
      APPEND lo_json->get_string( `/packages/` && lv_member ) TO rs_object-packages.
    ENDLOOP.
    lt_members = zcl_osd_adt_json=>ordered_members( io_json = lo_json iv_path = `/includes` ).
    LOOP AT lt_members INTO lv_member.
      APPEND lo_json->get_string( `/includes/` && lv_member ) TO rs_object-includes.
    ENDLOOP.
    rs_object-changed_at = lo_json->get_string( `/changedAt` ).
    rs_object-changed_by = lo_json->get_string( `/changedBy` ).
    rs_object-version = lo_json->get_string( `/version` ).

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
        ro_json = zcl_ajson=>parse( iv_json = iv_json iv_keep_item_order = abap_true ).
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
