"! What the ADT facade asks the host, through the one host seam there is:
"! ZOSD_STORE DESTINATION 'STORE' (tools/osd-store-destination.mjs,
"! docs/adt-abap-port/port-map.md section 3). No second destination.
"!
"! Slice 1 asks one thing, SYSTEM with the kind IDENTITY: who this system
"! says it is to an ADT client. That is not sy-sysid and not sy-mandt on
"! purpose (tools/osd-identity.mjs says why: a project stores the id it was
"! created against), so it is the host's to answer, per facade instance.
"! On a system there is no STORE destination; the call then fails and the
"! route answers the failure as a 500 rather than inventing an identity.
CLASS zcl_osd_adt_host DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_identity,
             system_id      TYPE string,
             user_name      TYPE string,
             user_full_name TYPE string,
             client         TYPE string,
             language       TYPE string,
           END OF ty_identity.

    "! one SYSTEM kind, answered as the host's JSON text
    CLASS-METHODS system
      IMPORTING iv_kind        TYPE string
      RETURNING VALUE(rv_json) TYPE string
      RAISING   zcx_osd_adt.

    CLASS-METHODS identity
      RETURNING VALUE(rs_identity) TYPE ty_identity
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

  METHOD identity.
    DATA lv_json TYPE string.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lx_json TYPE REF TO zcx_ajson_error.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    lv_json = system( `IDENTITY` ).
    TRY.
        lo_json = zcl_ajson=>parse( lv_json ).
      CATCH zcx_ajson_error INTO lx_json.
        lv_json = |SYSTEM IDENTITY is not JSON: { lx_json->get_text( ) }|.
        lx_error = zcx_osd_adt=>internal( lv_json ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
    rs_identity-system_id = lo_json->get_string( `/systemID` ).
    rs_identity-user_name = lo_json->get_string( `/userName` ).
    rs_identity-user_full_name = lo_json->get_string( `/userFullName` ).
    rs_identity-client = lo_json->get_string( `/client` ).
    rs_identity-language = lo_json->get_string( `/language` ).
  ENDMETHOD.

ENDCLASS.
