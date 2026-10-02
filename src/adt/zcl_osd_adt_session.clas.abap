"! Persistent ADT sessions; every SQL operation explicitly fences MANDT.
"! CREATED/TOUCHED are UTC TIMESTAMPs, as in ZOSD_TSES; TTL is seconds.
"! Node owners and the kernel share one adt:<instance>: prefix for holders.
"! Bare 24-hex ids address local sessions; holder keys prove host ownership.
"! Foreign holder prefixes stay live. No issued-id ledger is needed.
"! Dump cleanup is pulled before binding: no ABAP runs from an onEnd hook.
"! Missing ENQ context clears handles, then BIND opens the next context.
"! Ended keys delete their rows before the named refusal, never touch them.
"! The request handler catches that refusal inside its step so cleanup commits.
CLASS zcl_osd_adt_session DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_session.
    METHODS constructor
      IMPORTING iv_ttl_seconds TYPE i DEFAULT 1800
                iv_now TYPE timestamp OPTIONAL.
    "! Adapter read: no touch, expiry filtering or sweep.
    METHODS peek IMPORTING iv_id TYPE string RETURNING VALUE(rs_row) TYPE zosd_adt_sess.
    "! Adapter snapshot of handles; no touch or ownership changes.
    TYPES ty_handles TYPE STANDARD TABLE OF zosd_adt_shdl WITH DEFAULT KEY.
    METHODS handles IMPORTING iv_id TYPE string RETURNING VALUE(rt_rows) TYPE ty_handles.
    "! Test clock; initial means the real UTC clock.
    METHODS set_clock IMPORTING iv_now TYPE timestamp.
  PRIVATE SECTION.
    DATA mv_ttl TYPE i.
    DATA mv_now TYPE timestamp.
    METHODS now RETURNING VALUE(rv_now) TYPE timestamp.
    METHODS cutoff RETURNING VALUE(rv_cutoff) TYPE timestamp.
    METHODS sweep.
    METHODS field
      IMPORTING it_fields TYPE tihttpnvp iv_name TYPE string
                iv_header TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rv_value) TYPE string.
    METHODS random IMPORTING iv_kind TYPE string RETURNING VALUE(rv_value) TYPE string.
    METHODS open
      IMPORTING it_headers TYPE tihttpnvp
      RETURNING VALUE(rs_row) TYPE zosd_adt_sess
      RAISING zcx_osd_adt.
    METHODS find_handle
      IMPORTING iv_id TYPE string iv_type TYPE string iv_name TYPE string
      RETURNING VALUE(rs_row) TYPE zosd_adt_shdl.
    METHODS cookie_name RETURNING VALUE(rv_name) TYPE string RAISING zcx_osd_adt.
    METHODS bind IMPORTING is_row TYPE zosd_adt_sess RAISING zcx_osd_adt.
ENDCLASS.

CLASS zcl_osd_adt_session IMPLEMENTATION.
  METHOD constructor.
    mv_ttl = iv_ttl_seconds.
    mv_now = iv_now.
  ENDMETHOD.

  METHOD peek.
    SELECT SINGLE * FROM zosd_adt_sess INTO rs_row WHERE mandt = sy-mandt AND id = iv_id.
  ENDMETHOD.

  METHOD handles.
    SELECT * FROM zosd_adt_shdl INTO TABLE rt_rows WHERE mandt = sy-mandt AND id = iv_id.
  ENDMETHOD.

  METHOD random.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lv_first TYPE sysuuid_x16.
    DATA lv_second TYPE sysuuid_x16.
    DATA lv_bytes TYPE xstring.
    DATA lv_hex TYPE string.
    TRY.
        lv_first = cl_system_uuid=>create_uuid_x16_static( ).
        CASE iv_kind.
          WHEN `ID`.
            lv_hex = lv_first.
            rv_value = to_lower( lv_hex(24) ).
          WHEN `TOKEN`.
            lv_second = cl_system_uuid=>create_uuid_x16_static( ).
            CONCATENATE lv_first lv_second(2) INTO lv_bytes IN BYTE MODE.
            rv_value = cl_http_utility=>encode_x_base64( lv_bytes ).
            REPLACE ALL OCCURRENCES OF `+` IN rv_value WITH `-`.
            REPLACE ALL OCCURRENCES OF `/` IN rv_value WITH `_`.
          WHEN `HANDLE`.
            rv_value = to_lower( cl_system_uuid=>create_uuid_c36_static( ) ).
        ENDCASE.
      CATCH cx_uuid_error.
        lx_error = zcx_osd_adt=>internal( `could not generate session randomness` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.

  METHOD set_clock.
    mv_now = iv_now.
  ENDMETHOD.

  METHOD now.
    rv_now = mv_now.
    IF rv_now IS INITIAL.
      GET TIME STAMP FIELD rv_now.
    ENDIF.
  ENDMETHOD.

  METHOD cutoff.
    rv_cutoff = cl_abap_tstmp=>subtractsecs( tstmp = now( ) secs = mv_ttl ).
  ENDMETHOD.

  METHOD sweep.
    DATA lt_rows TYPE STANDARD TABLE OF zosd_adt_sess WITH DEFAULT KEY.
    DATA ls_row TYPE zosd_adt_sess.
    DATA lv_cutoff TYPE timestamp.
    DATA lv_id TYPE string.
    lv_cutoff = cutoff( ).
    SELECT * FROM zosd_adt_sess INTO TABLE lt_rows
      WHERE mandt = sy-mandt AND touched < lv_cutoff.
    LOOP AT lt_rows INTO ls_row.
      lv_id = ls_row-id.
      zif_osd_adt_session~end( lv_id ).
    ENDLOOP.
  ENDMETHOD.

  METHOD field.
    DATA ls_field TYPE ihttpnvp.
    LOOP AT it_fields INTO ls_field.
      IF ls_field-name = iv_name OR ( iv_header = abap_true AND to_lower( ls_field-name ) = to_lower( iv_name ) ).
        rv_value = ls_field-value.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD cookie_name.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    ls_identity = zcl_osd_adt_host=>identity( ).
    rv_name = |SAP_SESSIONID_{ ls_identity-system_id }_{ ls_identity-client }|.
  ENDMETHOD.

  METHOD open.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA lv_auth TYPE string.
    DATA lv_user TYPE string.
    DATA lv_password TYPE string.
    ls_identity = zcl_osd_adt_host=>identity( ).
    lv_auth = field( it_fields = it_headers iv_name = `authorization` iv_header = abap_true ).
    IF strlen( lv_auth ) >= 6 AND to_lower( lv_auth(6) ) = `basic `.
      lv_auth = lv_auth+6.
      lv_user = cl_http_utility=>decode_base64( lv_auth ).
      SPLIT lv_user AT `:` INTO lv_user lv_password.
      lv_user = to_upper( lv_user ).
    ENDIF.
    IF lv_user IS INITIAL.
      lv_user = ls_identity-user_name.
    ENDIF.
    rs_row-mandt = sy-mandt.
    rs_row-id = random( `ID` ).
    rs_row-token = random( `TOKEN` ).
    rs_row-username = lv_user.
    rs_row-created = now( ).
    rs_row-touched = rs_row-created.
    INSERT zosd_adt_sess FROM rs_row.
  ENDMETHOD.

  METHOD bind.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    DATA lv_id TYPE string.
    DATA lv_user TYPE string.
    lv_id = is_row-id.
    lv_user = is_row-username.
    IF zcl_osd_enq_kernel=>context_alive( lv_id ) = abap_false.
      zif_osd_adt_session~enq_context_ended( lv_id ).
    ENDIF.
    IF zcl_osd_enq_kernel=>bind( iv_id = lv_id iv_user = lv_user ) = abap_false.
      DELETE FROM zosd_adt_shdl WHERE mandt = sy-mandt AND id = lv_id.
      DELETE FROM zosd_adt_sess WHERE mandt = sy-mandt AND id = lv_id.
      lx_error = zcx_osd_adt=>session_ended( ).
      RAISE EXCEPTION lx_error.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_session~resolve.
    DATA lv_id TYPE string.
    DATA lv_cookie TYPE string.
    DATA lv_type TYPE string.
    DATA ls_row TYPE zosd_adt_sess.
    sweep( ).
    lv_id = field( it_fields = it_cookies iv_name = zif_osd_adt_session=>c_context_cookie ).
    IF lv_id IS INITIAL.
      lv_cookie = cookie_name( ).
      lv_id = field( it_fields = it_cookies iv_name = lv_cookie ).
    ENDIF.
    SELECT SINGLE * FROM zosd_adt_sess INTO ls_row WHERE mandt = sy-mandt AND id = lv_id.
    IF sy-subrc <> 0.
      ls_row = open( it_headers ).
      rs_session-fresh = abap_true.
    ENDIF.
    lv_type = field( it_fields = it_headers iv_name = `x-sap-adt-sessiontype` iv_header = abap_true ).
    IF to_lower( lv_type ) = `stateful`.
      ls_row-stateful = abap_true.
    ENDIF.
    rs_session-id = ls_row-id.
    rs_session-user = ls_row-username.
    rs_session-token = ls_row-token.
    rs_session-stateful = ls_row-stateful.
    IF ls_row-stateful = abap_true.
      bind( ls_row ).
    ENDIF.
    ls_row-touched = now( ).
    UPDATE zosd_adt_sess FROM ls_row.
  ENDMETHOD.

  METHOD zif_osd_adt_session~cookies.
    DATA lv_cookie TYPE string.
    IF is_session-fresh = abap_false AND is_session-stateful = abap_false.
      RETURN.
    ENDIF.
    lv_cookie = cookie_name( ).
    APPEND |sap-contextid={ is_session-id }; Path=/sap/bc/adt; HttpOnly; SameSite=Strict| TO rt_cookies.
    APPEND |{ lv_cookie }={ is_session-id }; Path=/; HttpOnly; SameSite=Strict| TO rt_cookies.
  ENDMETHOD.

  METHOD zif_osd_adt_session~token_valid.
    DATA ls_row TYPE zosd_adt_sess.
    DATA lv_cutoff TYPE timestamp.
    lv_cutoff = cutoff( ).
    SELECT SINGLE * FROM zosd_adt_sess INTO ls_row
      WHERE mandt = sy-mandt AND id = iv_id AND touched >= lv_cutoff.
    rv_valid = boolc( sy-subrc = 0 AND ls_row-token = iv_token ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~end.
    DELETE FROM zosd_adt_shdl WHERE mandt = sy-mandt AND id = iv_id.
    DELETE FROM zosd_adt_sess WHERE mandt = sy-mandt AND id = iv_id.
    zcl_osd_enq_kernel=>end( iv_id ).
  ENDMETHOD.

  METHOD zif_osd_adt_session~alive.
    DATA ls_row TYPE zosd_adt_sess.
    DATA lv_id TYPE string.
    DATA lv_cutoff TYPE timestamp.
    lv_id = zcl_osd_enq_kernel=>session_id( iv_id ).
    SELECT SINGLE * FROM zosd_adt_sess INTO ls_row WHERE mandt = sy-mandt AND id = lv_id.
    IF sy-subrc <> 0 AND zcl_osd_enq_kernel=>owns( iv_id ) = abap_false
      AND NOT ( strlen( iv_id ) = 24 AND iv_id CO `0123456789abcdef` ).
      rv_alive = abap_true.
      RETURN.
    ENDIF.
    lv_cutoff = cutoff( ).
    rv_alive = boolc( ls_row-id IS NOT INITIAL AND ls_row-touched >= lv_cutoff ).
    IF rv_alive = abap_false.
      zif_osd_adt_session~end( lv_id ).
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_session~enq_context_ended.
    DELETE FROM zosd_adt_shdl WHERE mandt = sy-mandt AND id = iv_id.
  ENDMETHOD.

  METHOD find_handle.
    DATA lt_rows TYPE STANDARD TABLE OF zosd_adt_shdl WITH DEFAULT KEY.
    DATA ls_row TYPE zosd_adt_shdl.
    SELECT * FROM zosd_adt_shdl INTO TABLE lt_rows WHERE mandt = sy-mandt AND id = iv_id.
    LOOP AT lt_rows INTO ls_row.
      IF to_upper( ls_row-objtype ) = to_upper( iv_type ) AND to_upper( ls_row-objname ) = to_upper( iv_name ).
        rs_row = ls_row.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD zif_osd_adt_session~adopt_handle.
    DATA ls_row TYPE zosd_adt_shdl.
    ls_row = find_handle( iv_id = iv_id iv_type = iv_type iv_name = iv_name ).
    IF ls_row-handle IS INITIAL.
      ls_row-mandt = sy-mandt.
      ls_row-id = iv_id.
      ls_row-handle = random( `HANDLE` ).
      ls_row-objtype = iv_type.
      ls_row-objname = iv_name.
      INSERT zosd_adt_shdl FROM ls_row.
    ENDIF.
    rv_handle = ls_row-handle.
  ENDMETHOD.

  METHOD zif_osd_adt_session~release_handle.
    DATA ls_row TYPE zosd_adt_shdl.
    CLEAR: ev_type, ev_name.
    SELECT SINGLE * FROM zosd_adt_shdl INTO ls_row
      WHERE mandt = sy-mandt AND id = iv_id AND handle = iv_handle.
    IF sy-subrc = 0.
      ev_type = ls_row-objtype.
      ev_name = ls_row-objname.
      DELETE FROM zosd_adt_shdl WHERE mandt = sy-mandt AND id = iv_id AND handle = iv_handle.
    ENDIF.
  ENDMETHOD.

  METHOD zif_osd_adt_session~holds.
    DATA ls_row TYPE zosd_adt_shdl.
    SELECT SINGLE * FROM zosd_adt_shdl INTO ls_row
      WHERE mandt = sy-mandt AND id = iv_id AND handle = iv_handle.
    rv_holds = boolc( sy-subrc = 0 AND to_upper( ls_row-objtype ) = to_upper( iv_type ) AND to_upper( ls_row-objname ) = to_upper( iv_name ) ).
  ENDMETHOD.
ENDCLASS.
