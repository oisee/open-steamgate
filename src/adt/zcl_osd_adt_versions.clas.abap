"! GET and HEAD of source versions. The Node facade's versions routes and
"! tools/adt-versions.mjs define the representation this class writes.
CLASS zcl_osd_adt_versions DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
  PRIVATE SECTION.
    TYPES tt_revision TYPE STANDARD TABLE OF zosd_revision_s WITH DEFAULT KEY.
    CLASS-METHODS field
      IMPORTING it_fields TYPE tihttpnvp iv_name TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS xml
      IMPORTING iv_text TYPE csequence
      RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS iso
      IMPORTING iv_date TYPE d iv_time TYPE t
      RETURNING VALUE(rv_iso) TYPE string.
    CLASS-METHODS stamp
      IMPORTING iv_date TYPE d iv_time TYPE t
      RETURNING VALUE(rv_stamp) TYPE string.
    "! one version's source, as versionSource reads it (not 00000)
    CLASS-METHODS content
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
                iv_type            TYPE string
                iv_name            TYPE string
                iv_include         TYPE string
                iv_version         TYPE string
                iv_file            TYPE string
                iv_missing         TYPE abap_bool
                it_revision        TYPE tt_revision
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    "! the Atom feed of the versions, as versionsFeedDocument writes it
    CLASS-METHODS feed
      IMPORTING is_request         TYPE zif_osd_adt_route=>ty_request
                iv_collection      TYPE string
                iv_type            TYPE string
                iv_name            TYPE string
                iv_title           TYPE csequence
                iv_include         TYPE string
                iv_missing         TYPE abap_bool
                iv_state           TYPE string
                iv_changed         TYPE string
                iv_note            TYPE string
                it_revision        TYPE tt_revision
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response
      RAISING   zcx_osd_adt.
    CLASS-METHODS entity
      IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
                iv_body TYPE string
                iv_type TYPE string
                iv_note TYPE string OPTIONAL
      RETURNING VALUE(rs_response) TYPE zif_osd_adt_route=>ty_response.
ENDCLASS.

CLASS zcl_osd_adt_versions IMPLEMENTATION.
  METHOD field.
    DATA ls_field TYPE ihttpnvp.
    LOOP AT it_fields INTO ls_field.
      IF to_lower( ls_field-name ) = to_lower( iv_name ).
        rv_value = ls_field-value.
        RETURN.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD xml.
    rv_text = zcl_osd_adt_xml=>esc( CONV string( iv_text ) ).
  ENDMETHOD.

  METHOD iso.
    rv_iso = iv_date(4) && `-` && iv_date+4(2) && `-` && iv_date+6(2)
      && `T` && iv_time(2) && `:` && iv_time+2(2) && `:` && iv_time+4(2) && `Z`.
  ENDMETHOD.

  METHOD stamp.
    rv_stamp = iv_date && iv_time.
  ENDMETHOD.

  METHOD entity.
    DATA lv_charset TYPE abap_bool.
*   The Node feed is sent as a Buffer, so Express adds no charset.
    lv_charset = boolc( iv_type = `text/plain` ).
    rs_response = zcl_osd_adt_entity=>send( is_request = is_request iv_body = iv_body
      iv_type = iv_type iv_note = iv_note iv_charset = lv_charset ).
  ENDMETHOD.

  METHOD zif_osd_adt_route~handle.
    DATA lt_types TYPE zcl_osd_adt_types=>tt_type.
    DATA ls_type TYPE zcl_osd_adt_types=>ty_type.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_include TYPE string.
    DATA lv_version TYPE string.
    DATA lv_file TYPE string.
    DATA lv_source TYPE string.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.
    DATA lv_note TYPE string.
    DATA lv_state TYPE string.
    DATA lv_changed TYPE string.
    DATA lv_limit TYPE string VALUE `100000`.
    DATA lv_collection TYPE string.
    DATA lv_index TYPE i.
    DATA lv_count TYPE i.
    DATA lv_content TYPE abap_bool.
    DATA lv_missing TYPE abap_bool.
    DATA lt_revision TYPE tt_revision.
    DATA ls_revision TYPE zosd_revision_s.
    DATA lt_object TYPE STANDARD TABLE OF zosd_object_s WITH DEFAULT KEY.
    DATA ls_object TYPE zosd_object_s.
    DATA ls_active TYPE zcl_osd_adt_host=>ty_read.
    DATA lx_error TYPE REF TO zcx_osd_adt.

    lt_types = zcl_osd_adt_types=>sources( ).
    LOOP AT lt_types INTO ls_type.
      lv_collection = zcl_osd_adt_router=>c_base && `/` && ls_type-collection && `/`.
      IF to_lower( is_request-path ) CP to_lower( lv_collection ) && `*`.
        lv_type = ls_type-type.
        EXIT.
      ENDIF.
    ENDLOOP.
    LOOP AT is_request-params INTO ls_param.
      CASE ls_param-name.
        WHEN `name`.
          lv_name = ls_param-value.
        WHEN `include`.
          lv_include = ls_param-value.
        WHEN `version`.
          lv_version = ls_param-value.
          lv_content = abap_true.
      ENDCASE.
    ENDLOOP.
    IF lv_type = `INTF` AND lv_include IS NOT INITIAL AND lv_include <> `main`.
      lx_error = zcx_osd_adt=>not_found( |INTF { lv_name } include { lv_include } does not exist| ).
      RAISE EXCEPTION lx_error.
    ENDIF.

*   History listing and git revisions do not require active source proof.
    IF lv_content = abap_true AND lv_version = `00000`.
      ls_active = zcl_osd_adt_source=>read( iv_type = lv_type iv_name = lv_name iv_include = lv_include iv_version = `active` ).
      rs_response = entity( is_request = is_request iv_body = ls_active-source iv_type = `text/plain` ).
      RETURN.
    ENDIF.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `READ` iv_type = lv_type iv_name = lv_name iv_include = lv_include iv_revision = `inactive`
      IMPORTING ev_source = lv_source ev_error = lv_error
      TABLES et_object = lt_object
      EXCEPTIONS system_failure = 1 MESSAGE lv_msg communication_failure = 2 MESSAGE lv_msg OTHERS = 3.
    IF sy-subrc <> 0.
      lv_error = |no object store here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      IF lv_error CS ` include `.
        lx_error = zcx_osd_adt=>not_found( |{ lv_type } { lv_name } include { lv_include } does not exist| ).
      ELSE.
        lx_error = zcx_osd_adt=>not_found( |{ lv_type } { lv_name } does not exist| ).
      ENDIF.
      RAISE EXCEPTION lx_error.
    ENDIF.
    READ TABLE lt_object INDEX 1 INTO ls_object.
    CLEAR lv_error.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `HISTORY` iv_type = lv_type iv_name = lv_name
                iv_include = lv_include iv_limit = lv_limit
      IMPORTING ev_file = lv_file ev_note = lv_note ev_state = lv_state
                ev_changed = lv_changed ev_error = lv_error
      TABLES et_revision = lt_revision
      EXCEPTIONS system_failure = 1 MESSAGE lv_msg communication_failure = 2 MESSAGE lv_msg OTHERS = 3.
    IF sy-subrc <> 0.
      lv_error = |no object store here: { lv_msg }|.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      lx_error = zcx_osd_adt=>internal( lv_error ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    lv_missing = boolc( lv_file IS INITIAL ).
    IF lv_note CP 'no history: *'.
      lv_note = substring( val = lv_note off = 12 ).
    ENDIF.

    IF lv_content = abap_true.
      rs_response = content( is_request = is_request iv_type = lv_type iv_name = lv_name
                             iv_include = lv_include iv_version = lv_version iv_file = lv_file
                             iv_missing = lv_missing it_revision = lt_revision ).
      RETURN.
    ENDIF.

    rs_response = feed( is_request = is_request iv_collection = ls_type-collection iv_type = lv_type
                        iv_name = lv_name iv_title = ls_object-name iv_include = lv_include
                        iv_missing = lv_missing iv_state = lv_state iv_changed = lv_changed
                        iv_note = lv_note it_revision = lt_revision ).
  ENDMETHOD.

  METHOD content.
    DATA lv_error TYPE string.
    DATA lv_msg TYPE c LENGTH 255.
    DATA lv_source TYPE string.
    DATA lv_index TYPE i.
    DATA lv_count TYPE i.
    DATA ls_revision TYPE zosd_revision_s.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    IF strlen( iv_version ) <> 5 OR iv_version CN `0123456789`.
      lv_error = |{ iv_version } is not a version number|.
    ELSEIF iv_version <> `00000`.
      IF iv_missing = abap_true.
        lv_error = `the include has no file, so no version but 00000`.
      ELSE.
        lv_count = lines( it_revision ).
        lv_index = lv_count - iv_version + 1.
        IF lv_index < 1 OR lv_index > lv_count.
          lv_error = |{ iv_file } has no version { iv_version }|.
        ELSE.
          READ TABLE it_revision INDEX lv_index INTO ls_revision.
          CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
            EXPORTING iv_command = `REVISION` iv_type = iv_type iv_name = iv_name
                      iv_include = iv_include iv_revision = ls_revision-revision
            IMPORTING ev_source = lv_source ev_error = lv_error
            EXCEPTIONS system_failure = 1 MESSAGE lv_msg communication_failure = 2 MESSAGE lv_msg OTHERS = 3.
          IF sy-subrc <> 0.
            lv_error = |no object store here: { lv_msg }|.
          ENDIF.
        ENDIF.
      ENDIF.
    ENDIF.
    IF lv_error IS NOT INITIAL.
      lx_error = zcx_osd_adt=>not_found(
        |{ iv_type } { iv_name } version { iv_version } ({ lv_error }) does not exist| ).
      RAISE EXCEPTION lx_error.
    ENDIF.
    rs_response = entity( is_request = is_request iv_body = lv_source
                          iv_type = `text/plain` ).
  ENDMETHOD.

  METHOD feed.
    DATA lv_base TYPE string.
    DATA lv_title_type TYPE string.
    DATA lv_feed TYPE string.
    DATA lv_date TYPE string.
    DATA lv_author TYPE string.
    DATA lv_stamp TYPE string.
    DATA lv_number TYPE string.
    DATA lv_index TYPE i.
    DATA lv_count TYPE i.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA ls_revision TYPE zosd_revision_s.
    ls_identity = zcl_osd_adt_host=>identity( ).
    lv_base = zcl_osd_adt_router=>c_base && `/` && iv_collection
      && `/` && zcl_osd_adt_uri=>encode_component( to_lower( iv_name ) ).
    IF iv_include IS INITIAL.
      lv_base = lv_base && `/source/main/versions`.
    ELSE.
      lv_base = lv_base && `/includes/` && iv_include && `/versions`.
    ENDIF.
    lv_title_type = iv_type.
    IF iv_type = `PROG` OR iv_type = `INCL`.
      lv_title_type = `REPS`.
    ENDIF.
    lv_feed = `<?xml version="1.0" encoding="utf-8"?>`
      && `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">`
      && `<atom:title>Version List of ` && xml( iv_title )
      && ` (` && lv_title_type && `)</atom:title>`
      && `<atom:updated>1970-01-01T10:11:23Z</atom:updated>`.
    lv_date = `1970-01-01T00:00:00Z`.
    lv_author = ls_identity-user_name.
    lv_count = lines( it_revision ).
    IF iv_missing = abap_false.
      IF iv_state = `clean` AND lv_count > 0.
        READ TABLE it_revision INDEX 1 INTO ls_revision.
        lv_date = iso( iv_date = ls_revision-date iv_time = ls_revision-time ).
        lv_author = ls_revision-author.
      ELSEIF strlen( iv_changed ) >= 19.
        lv_date = iv_changed(19) && `Z`.
      ENDIF.
    ENDIF.
    lv_feed = lv_feed && `<atom:entry><atom:author><atom:name>` && xml( lv_author )
      && `</atom:name></atom:author><atom:content type="text/plain" src="`
      && xml( lv_base && `/19700101101123/00000/content` )
      && `"/><atom:id>00000</atom:id><atom:updated>` && lv_date
      && `</atom:updated></atom:entry>`.
    lv_index = 0.
    LOOP AT it_revision INTO ls_revision.
      lv_index = lv_index + 1.
      lv_number = lv_count - lv_index + 1.
      lv_number = |{ lv_number WIDTH = 5 PAD = '0' ALIGN = RIGHT }|.
      lv_stamp = stamp( iv_date = ls_revision-date iv_time = ls_revision-time ).
      lv_feed = lv_feed && `<atom:entry><atom:author><atom:name>` && xml( ls_revision-author )
        && `</atom:name></atom:author><atom:content type="text/plain" src="`
        && xml( lv_base && `/` && lv_stamp && `/` && lv_number && `/content` )
        && `"/><atom:id>` && lv_number && `</atom:id><atom:title>`
        && xml( ls_revision-subject_full ) && `</atom:title><atom:updated>`
        && iso( iv_date = ls_revision-date iv_time = ls_revision-time ) && `</atom:updated></atom:entry>`.
    ENDLOOP.
    lv_feed = lv_feed && `</atom:feed>`.
    rs_response = entity( is_request = is_request iv_body = lv_feed
                          iv_type = `application/atom+xml;type=feed` iv_note = iv_note ).
  ENDMETHOD.
ENDCLASS.
