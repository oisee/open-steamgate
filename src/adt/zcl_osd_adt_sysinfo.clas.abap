"! GET /sap/bc/adt/core/http/systeminformation: who this system is, read
"! once by a client at logon and shown in its window title.
"!
"! The values are the host's (ZCL_OSD_ADT_HOST, SYSTEM IDENTITY); the
"! document is ours: five keys in the Node facade's order and JSON text
"! byte-equal to its JSON.stringify for the values a system has (Gate 1,
"! test/adt-abap-diff.mjs). The string escape covers the quote, the
"! backslash and the five named control characters; an identity is trimmed
"! text from the environment, so the other control characters, which
"! JSON.stringify writes as \u00XX, do not occur.
CLASS zcl_osd_adt_sysinfo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_content_type TYPE string
      VALUE `application/vnd.sap.adt.core.http.systeminformation.v1+json; charset=utf-8`.
    CLASS-METHODS json_string
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_osd_adt_sysinfo IMPLEMENTATION.

  METHOD zif_osd_adt_route~handle.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.

    ls_identity = zcl_osd_adt_host=>identity( ).
    rs_response-status = 200.
    rs_response-content_type = c_content_type.
    rs_response-body = `{"systemID":` && json_string( ls_identity-system_id )
      && `,"userName":` && json_string( ls_identity-user_name )
      && `,"userFullName":` && json_string( ls_identity-user_full_name )
      && `,"client":` && json_string( ls_identity-client )
      && `,"language":` && json_string( ls_identity-language ) && `}`.
  ENDMETHOD.

  METHOD json_string.
    rv_json = iv_text.
    REPLACE ALL OCCURRENCES OF `\` IN rv_json WITH `\\`.
    REPLACE ALL OCCURRENCES OF `"` IN rv_json WITH `\"`.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_json WITH `\n`.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf(1) IN rv_json WITH `\r`.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_json WITH `\t`.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>backspace IN rv_json WITH `\b`.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>form_feed IN rv_json WITH `\f`.
    rv_json = `"` && rv_json && `"`.
  ENDMETHOD.

ENDCLASS.
