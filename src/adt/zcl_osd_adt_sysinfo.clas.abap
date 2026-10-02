CLASS zcl_osd_adt_sysinfo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CONSTANTS c_content_type TYPE string
      VALUE `application/vnd.sap.adt.core.http.systeminformation.v1+json; charset=utf-8`.
ENDCLASS.

CLASS zcl_osd_adt_sysinfo IMPLEMENTATION.

  METHOD zif_osd_adt_route~handle.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.

    ls_identity = zcl_osd_adt_host=>identity( ).
    rs_response-status = 200.
    rs_response-content_type = c_content_type.
    rs_response-body = `{"systemID":` && zcl_osd_adt_json=>quote( ls_identity-system_id )
      && `,"userName":` && zcl_osd_adt_json=>quote( ls_identity-user_name )
      && `,"userFullName":` && zcl_osd_adt_json=>quote( ls_identity-user_full_name )
      && `,"client":` && zcl_osd_adt_json=>quote( ls_identity-client )
      && `,"language":` && zcl_osd_adt_json=>quote( ls_identity-language ) && `}`.
  ENDMETHOD.



ENDCLASS.
