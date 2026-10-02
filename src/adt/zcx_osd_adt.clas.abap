"! A refusal of the ADT facade: the HTTP status, the exception type id, its
"! namespace, the message and the properties a system carries (a T100 key,
"! a long text). ZCL_OSD_ADT_HANDLER catches it once and answers DOCUMENT( )
"! as application/xml.
"!
"! The document is byte-equal to exceptionDocument in tools/adt-documents.mjs
"! (Gate 1, test/adt-abap-diff.mjs): same declaration, same indentation, a
"! self-closing properties element when there are none, a final newline.
"!
"! The factories are the Node facade's answered( ) mapping, said once:
"! NotFound 404, ReadOnly 405, NotSupported 501, Conflict 409, anything
"! else 500 in our own namespace. Two more for the lock route: InvalidRequest
"! 400, and the refusal of a lock another session holds (403, EU 510).
CLASS zcx_osd_adt DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_namespace_adt TYPE string VALUE `com.sap.adt`.
    CONSTANTS c_namespace_osd TYPE string VALUE `org.open-steamgate.osd`.

    CONSTANTS c_session_ended TYPE string VALUE `ExceptionSessionEnded`.
    CONSTANTS c_system_not_supported TYPE string VALUE `ExceptionSystemNotSupported`.

    CLASS-METHODS session_ended RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS system_not_supported RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.

    CONSTANTS c_miss_none TYPE string VALUE `none`.
    CONSTANTS c_miss_object TYPE string VALUE `object`.
    CONSTANTS c_miss_resource TYPE string VALUE `resource`.
    DATA miss TYPE string READ-ONLY.
    DATA status TYPE i READ-ONLY.
    DATA type_id TYPE string READ-ONLY.
    DATA namespace TYPE string READ-ONLY.
    DATA message_text TYPE string READ-ONLY.
    DATA properties TYPE tihttpnvp READ-ONLY.

    METHODS constructor
      IMPORTING iv_status     TYPE i DEFAULT 500
                iv_type       TYPE string DEFAULT `ExceptionInternalError`
                iv_message    TYPE string OPTIONAL
                iv_namespace  TYPE string DEFAULT c_namespace_adt
                it_properties TYPE tihttpnvp OPTIONAL
                iv_miss       TYPE string DEFAULT c_miss_none
                previous      TYPE REF TO cx_root OPTIONAL.

    METHODS get_text REDEFINITION.

    "! the exception document, as the wire carries it
    METHODS document
      RETURNING VALUE(rv_xml) TYPE string.

    CLASS-METHODS not_found
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_adt
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS read_only
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_adt
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS not_supported
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_adt
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS conflict
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_adt
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS internal
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_osd
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS invalid_request
      IMPORTING iv_message      TYPE string
                iv_namespace TYPE string DEFAULT c_namespace_adt
                iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS modified
      IMPORTING iv_message TYPE string
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS not_locked
      IMPORTING iv_message TYPE string
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS wrong_data
      IMPORTING iv_message TYPE string
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS no_access
      IMPORTING iv_message TYPE string iv_status TYPE i DEFAULT 403
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS not_built
      IMPORTING iv_message TYPE string
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    CLASS-METHODS transport_check_failed
      IMPORTING iv_message TYPE string
        iv_namespace TYPE string DEFAULT c_namespace_adt iv_miss TYPE string DEFAULT c_miss_none
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
    "! another editing session holds the object: 403, T100 EU 510 with the
    "! holder's user in V1 and the object in V2, as a system refuses
    CLASS-METHODS locked_by_other
      IMPORTING iv_user         TYPE string
                iv_object       TYPE string
      RETURNING VALUE(ro_error) TYPE REF TO zcx_osd_adt.
ENDCLASS.

CLASS zcx_osd_adt IMPLEMENTATION.

  METHOD session_ended.
    CREATE OBJECT ro_error
      EXPORTING iv_status = 403 iv_type = c_session_ended
                iv_namespace = c_namespace_osd iv_message = `the ADT session has ended`.
  ENDMETHOD.

  METHOD system_not_supported.
    CREATE OBJECT ro_error
      EXPORTING iv_status = 501 iv_type = c_system_not_supported
                iv_namespace = c_namespace_osd iv_message = `not supported on this system`.
  ENDMETHOD.

  METHOD modified.
    CREATE OBJECT ro_error EXPORTING iv_status = 412
      iv_type = `ExceptionResourceIsModified` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.
  METHOD not_locked.
    CREATE OBJECT ro_error EXPORTING iv_status = 409
      iv_type = `ExceptionResourceNotLocked` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.
  METHOD wrong_data.
    CREATE OBJECT ro_error EXPORTING iv_status = 400
      iv_type = `ExceptionResourceWrongData` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.
  METHOD no_access.
    CREATE OBJECT ro_error EXPORTING iv_status = iv_status
      iv_type = `ExceptionResourceNoAccess` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.
  METHOD not_built.
    CREATE OBJECT ro_error EXPORTING iv_status = 503
      iv_type = `ExceptionResourceNoAccess` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.
  METHOD transport_check_failed.
    CREATE OBJECT ro_error EXPORTING iv_status = 500
      iv_type = `ExceptionTransportCheckFailed` iv_message = iv_message iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD constructor.
    super->constructor( previous = previous ).
    status = iv_status.
    type_id = iv_type.
    message_text = iv_message.
    namespace = iv_namespace.
    properties = it_properties.
    miss = iv_miss.
  ENDMETHOD.

  METHOD get_text.
    result = message_text.
  ENDMETHOD.

  METHOD document.
    DATA lv_nl TYPE string.
    DATA lv_props TYPE string.
    DATA lv_message TYPE string.
    DATA ls_property LIKE LINE OF properties.

    lv_nl = cl_abap_char_utilities=>newline.
    IF properties IS INITIAL.
      lv_props = `  <properties/>`.
    ELSE.
      lv_props = `  <properties>` && lv_nl.
      LOOP AT properties INTO ls_property.
        lv_props = lv_props && `    <entry key="` && zcl_osd_adt_xml=>esc( ls_property-name ) && `">`
          && zcl_osd_adt_xml=>esc( ls_property-value ) && `</entry>` && lv_nl.
      ENDLOOP.
      lv_props = lv_props && `  </properties>`.
    ENDIF.
    lv_message = zcl_osd_adt_xml=>esc( message_text ).

    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">` && lv_nl
      && `  <namespace id="` && zcl_osd_adt_xml=>esc( namespace ) && `"/>` && lv_nl
      && `  <type id="` && zcl_osd_adt_xml=>esc( type_id ) && `"/>` && lv_nl
      && `  <message lang="EN">` && lv_message && `</message>` && lv_nl
      && `  <localizedMessage lang="EN">` && lv_message && `</localizedMessage>` && lv_nl
      && lv_props && lv_nl
      && `</exc:exception>` && lv_nl.
  ENDMETHOD.

  METHOD not_found.
    CREATE OBJECT ro_error
      EXPORTING iv_status  = 404
                iv_type    = `ExceptionResourceNotFound`
                iv_message = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD read_only.
    CREATE OBJECT ro_error
      EXPORTING iv_status  = 405
                iv_type    = `ExceptionResourceNoAccess`
                iv_message = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD not_supported.
    CREATE OBJECT ro_error
      EXPORTING iv_status  = 501
                iv_type    = `ExceptionResourceNoAccess`
                iv_message = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD conflict.
*   the id the client shows for "already exists" on a save over a changed
*   object; the Node facade chose it for the same reason
    CREATE OBJECT ro_error
      EXPORTING iv_status  = 409
                iv_type    = `ExceptionResourceIsModified`
                iv_message = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD internal.
    CREATE OBJECT ro_error
      EXPORTING iv_status    = 500
                iv_type      = `ExceptionInternalError`
                iv_message   = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD invalid_request.
    CREATE OBJECT ro_error
      EXPORTING iv_status  = 400
                iv_type    = `ExceptionInvalidRequest`
                iv_message = iv_message
                iv_namespace = iv_namespace iv_miss = iv_miss.
  ENDMETHOD.

  METHOD locked_by_other.
    DATA lt_properties TYPE tihttpnvp.
    DATA ls_property TYPE ihttpnvp.
    DATA lv_message TYPE string.

    lv_message = |User { iv_user } is currently editing { iv_object }|.
    ls_property-name = `LONGTEXT`.
    ls_property-value = |{ iv_object } is locked by another editing session of user { iv_user }. |
      && `It can be changed once that session saves and unlocks it, logs off, or expires.`.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-ID`.
    ls_property-value = `EU`.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-NO`.
    ls_property-value = `510`.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-V1`.
    ls_property-value = iv_user.
    APPEND ls_property TO lt_properties.
    ls_property-name = `T100KEY-V2`.
    ls_property-value = iv_object.
    APPEND ls_property TO lt_properties.
    CREATE OBJECT ro_error
      EXPORTING iv_status     = 403
                iv_type       = `ExceptionResourceNoAccess`
                iv_message    = lv_message
                it_properties = lt_properties.
  ENDMETHOD.

ENDCLASS.
