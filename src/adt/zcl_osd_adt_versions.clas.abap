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
    CLASS-METHODS uri_name
      IMPORTING iv_name TYPE string
      RETURNING VALUE(rv_name) TYPE string.
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

  METHOD uri_name.
*   encodeURIComponent after lowercasing, including UTF-8 bytes and upper
*   case hex. CL_HTTP_UTILITY=>ESCAPE_URL emits lower case hex instead.
    DATA lv_char TYPE string.
    DATA lv_bytes TYPE xstring.
    DATA lv_hex TYPE c LENGTH 2.
    DATA lv_index TYPE i.
    DATA lv_byte TYPE i.
    DO strlen( iv_name ) TIMES.
      lv_index = sy-index - 1.
      lv_char = iv_name+lv_index(1).
      IF to_upper( lv_char ) CA sy-abcde OR lv_char CA `0123456789-_.!~*'()`.
        rv_name = rv_name && lv_char.
      ELSE.
        lv_bytes = cl_abap_codepage=>convert_to( lv_char ).
        DO xstrlen( lv_bytes ) TIMES.
          lv_byte = sy-index - 1.
          lv_hex = lv_bytes+lv_byte(1).
          rv_name = rv_name && `%` && to_upper( lv_hex ).
        ENDDO.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD entity.
    DATA lv_hash TYPE string.
    DATA lv_candidates TYPE string_table.
    DATA lv_candidate TYPE string.
    DATA ls_header TYPE ihttpnvp.
    DATA lv_none TYPE string.
    cl_abap_message_digest=>calculate_hash_for_char(
      EXPORTING if_algorithm = 'SHA256' if_data = iv_body
      IMPORTING ef_hashstring = lv_hash ).
    lv_hash = to_lower( lv_hash(32) ).
    rs_response-status = 200.
    rs_response-content_type = iv_type.
    rs_response-body = iv_body.
    ls_header-name = `ETag`.
    ls_header-value = lv_hash.
    APPEND ls_header TO rs_response-headers.
    IF iv_note IS NOT INITIAL.
      ls_header-name = `X-OSD-History`.
      ls_header-value = `none: ` && iv_note.
      APPEND ls_header TO rs_response-headers.
    ENDIF.
    lv_none = field( it_fields = is_request-headers iv_name = `if-none-match` ).
    SPLIT lv_none AT `,` INTO TABLE lv_candidates.
    LOOP AT lv_candidates INTO lv_candidate.
      CONDENSE lv_candidate NO-GAPS.
      IF lv_candidate(2) = `W/`.
        lv_candidate = substring( val = lv_candidate off = 2 ).
      ENDIF.
      REPLACE ALL OCCURRENCES OF `"` IN lv_candidate WITH ``.
      IF lv_candidate = lv_hash.
        rs_response-status = 304.
        CLEAR rs_response-body.
        RETURN.
      ENDIF.
    ENDLOOP.
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
    DATA lv_base TYPE string.
    DATA lv_collection TYPE string.
    DATA lv_title_type TYPE string.
    DATA lv_feed TYPE string.
    DATA lv_date TYPE string.
    DATA lv_author TYPE string.
    DATA lv_stamp TYPE string.
    DATA lv_number TYPE string.
    DATA lv_index TYPE i.
    DATA lv_count TYPE i.
    DATA lv_content TYPE abap_bool.
    DATA lv_missing TYPE abap_bool.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    DATA lt_revision TYPE tt_revision.
    DATA ls_revision TYPE zosd_revision_s.
    DATA lt_object TYPE STANDARD TABLE OF zosd_object_s WITH DEFAULT KEY.
    DATA ls_object TYPE zosd_object_s.
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

*   READ validates the object and provides the active source, including an
*   empty class include. HISTORY uses the same include and resolved file.
    CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
      EXPORTING iv_command = `READ` iv_type = lv_type iv_name = lv_name iv_include = lv_include
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
      IF strlen( lv_version ) <> 5 OR lv_version CN `0123456789`.
        lv_error = |{ lv_version } is not a version number|.
      ELSEIF lv_version <> `00000`.
        IF lv_missing = abap_true.
          lv_error = `the include has no file, so no version but 00000`.
        ELSE.
          lv_count = lines( lt_revision ).
          lv_index = lv_count - lv_version + 1.
          IF lv_index < 1 OR lv_index > lv_count.
            lv_error = |{ lv_file } has no version { lv_version }|.
          ELSE.
            READ TABLE lt_revision INDEX lv_index INTO ls_revision.
            CALL FUNCTION 'ZOSD_STORE' DESTINATION 'STORE'
              EXPORTING iv_command = `REVISION` iv_type = lv_type iv_name = lv_name
                        iv_include = lv_include iv_revision = ls_revision-revision
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
          |{ lv_type } { lv_name } version { lv_version } ({ lv_error }) does not exist| ).
        RAISE EXCEPTION lx_error.
      ENDIF.
      rs_response = entity( is_request = is_request iv_body = lv_source
                            iv_type = `text/plain; charset=utf-8` ).
      RETURN.
    ENDIF.

    ls_identity = zcl_osd_adt_host=>identity( ).
    lv_base = zcl_osd_adt_router=>c_base && `/` && ls_type-collection
      && `/` && uri_name( to_lower( lv_name ) ).
    IF lv_include IS INITIAL.
      lv_base = lv_base && `/source/main/versions`.
    ELSE.
      lv_base = lv_base && `/includes/` && lv_include && `/versions`.
    ENDIF.
    lv_title_type = lv_type.
    IF lv_type = `PROG` OR lv_type = `INCL`.
      lv_title_type = `REPS`.
    ENDIF.
    lv_feed = `<?xml version="1.0" encoding="utf-8"?>`
      && `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">`
      && `<atom:title>Version List of ` && xml( ls_object-name )
      && ` (` && lv_title_type && `)</atom:title>`
      && `<atom:updated>1970-01-01T10:11:23Z</atom:updated>`.
    lv_date = `1970-01-01T00:00:00Z`.
    lv_author = ls_identity-user_name.
    lv_count = lines( lt_revision ).
    IF lv_missing = abap_false.
      IF lv_state = `clean` AND lv_count > 0.
        READ TABLE lt_revision INDEX 1 INTO ls_revision.
        lv_date = iso( iv_date = ls_revision-date iv_time = ls_revision-time ).
        lv_author = ls_revision-author.
      ELSEIF strlen( lv_changed ) >= 19.
        lv_date = lv_changed(19) && `Z`.
      ENDIF.
    ENDIF.
    lv_feed = lv_feed && `<atom:entry><atom:author><atom:name>` && xml( lv_author )
      && `</atom:name></atom:author><atom:content type="text/plain" src="`
      && xml( lv_base && `/19700101101123/00000/content` )
      && `"/><atom:id>00000</atom:id><atom:updated>` && lv_date
      && `</atom:updated></atom:entry>`.
    lv_index = 0.
    LOOP AT lt_revision INTO ls_revision.
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
                          iv_type = `application/atom+xml;type=feed` iv_note = lv_note ).
  ENDMETHOD.
ENDCLASS.
