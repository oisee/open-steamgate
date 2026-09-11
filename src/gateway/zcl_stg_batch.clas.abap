CLASS zcl_stg_batch DEFINITION PUBLIC CREATE PUBLIC.
* OData v2 $batch: multipart/mixed in, multipart/mixed out. Retrieve parts
* are dispatched one by one; a changeset is dispatched in order and answered
* as a whole: the first failing request becomes the changeset's single error
* response, like a real Gateway does. No rollback of the requests before it
* (see AGENDA: local SQLite has no transaction bracket yet).
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_request,
             method  TYPE string,
             url     TYPE string,
             headers TYPE tihttpnvp,
             body    TYPE string,
           END OF ty_request.
    TYPES ty_requests TYPE STANDARD TABLE OF ty_request WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_part,
             changeset TYPE abap_bool,
             requests  TYPE ty_requests,
           END OF ty_part.
    TYPES ty_parts TYPE STANDARD TABLE OF ty_part WITH DEFAULT KEY.

    CLASS-METHODS handle
      IMPORTING
        iv_body            TYPE string
        iv_content_type    TYPE string
        iv_service_path    TYPE string
        iv_host            TYPE string
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response
      RAISING
        zcx_stg_error.

    CLASS-METHODS boundary_of
      IMPORTING
        iv_content_type    TYPE string
      RETURNING
        VALUE(rv_boundary) TYPE string.

    CLASS-METHODS parse
      IMPORTING
        iv_body         TYPE string
        iv_boundary     TYPE string
      RETURNING
        VALUE(rt_parts) TYPE ty_parts
      RAISING
        zcx_stg_error.

    CLASS-METHODS format_part
      IMPORTING
        is_response      TYPE zcl_stg_dispatcher=>ty_response
      RETURNING
        VALUE(rv_string) TYPE string.
  PRIVATE SECTION.
    CLASS-DATA gv_counter TYPE i.

    CLASS-METHODS chunks
      IMPORTING
        iv_body          TYPE string
        iv_boundary      TYPE string
      RETURNING
        VALUE(rt_chunks) TYPE string_table.

    CLASS-METHODS split_headers
      IMPORTING
        iv_chunk   TYPE string
      EXPORTING
        et_headers TYPE tihttpnvp
        ev_rest    TYPE string.

    CLASS-METHODS header
      IMPORTING
        it_headers      TYPE tihttpnvp
        iv_name         TYPE string
      RETURNING
        VALUE(rv_value) TYPE string.

    CLASS-METHODS parse_request
      IMPORTING
        iv_chunk          TYPE string
      RETURNING
        VALUE(rs_request) TYPE ty_request
      RAISING
        zcx_stg_error.

    CLASS-METHODS run_request
      IMPORTING
        is_request         TYPE ty_request
        iv_service_path    TYPE string
        iv_host            TYPE string
      RETURNING
        VALUE(rs_response) TYPE zcl_stg_dispatcher=>ty_response.

    CLASS-METHODS byte_length
      IMPORTING
        iv_string     TYPE string
      RETURNING
        VALUE(rv_len) TYPE i.
ENDCLASS.

CLASS zcl_stg_batch IMPLEMENTATION.

  METHOD boundary_of.
    FIND REGEX 'boundary="?([^";]+)"?' IN iv_content_type SUBMATCHES rv_boundary.
    IF sy-subrc <> 0.
      CLEAR rv_boundary.
    ENDIF.
  ENDMETHOD.

  METHOD chunks.
    DATA lv_body      TYPE string.
    DATA lv_delimiter TYPE string.
    DATA lt_raw       TYPE string_table.
    DATA lv_raw       TYPE string.
    DATA lv_index     TYPE i.

    lv_body = iv_body.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_body WITH cl_abap_char_utilities=>newline.
    lv_delimiter = |--{ iv_boundary }|.
    SPLIT lv_body AT lv_delimiter INTO TABLE lt_raw.

* first chunk is the preamble, the last one the closing "--"
    LOOP AT lt_raw INTO lv_raw.
      lv_index = sy-tabix.
      IF lv_index = 1.
        CONTINUE.
      ENDIF.
      IF lv_raw CP '--*'.
        EXIT.
      ENDIF.
      IF lv_raw CP '+*'.
* drop the newline that follows the delimiter
        lv_raw = lv_raw+1.
      ENDIF.
      APPEND lv_raw TO rt_chunks.
    ENDLOOP.
  ENDMETHOD.

  METHOD split_headers.
    DATA lt_lines TYPE string_table.
    DATA lv_line  TYPE string.
    DATA ls_hdr   TYPE ihttpnvp.
    DATA lv_index TYPE i.
    DATA lv_rest  TYPE string.

    CLEAR et_headers.
    CLEAR ev_rest.
    SPLIT iv_chunk AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line.
      lv_index = sy-tabix.
      IF lv_line IS INITIAL.
        EXIT.
      ENDIF.
      CLEAR ls_hdr.
      SPLIT lv_line AT ':' INTO ls_hdr-name ls_hdr-value.
      ls_hdr-name = to_lower( condense( ls_hdr-name ) ).
      CONDENSE ls_hdr-value.
      APPEND ls_hdr TO et_headers.
    ENDLOOP.
    LOOP AT lt_lines INTO lv_line FROM lv_index + 1.
      IF lv_rest IS INITIAL.
        lv_rest = lv_line.
      ELSE.
        lv_rest = lv_rest && cl_abap_char_utilities=>newline && lv_line.
      ENDIF.
    ENDLOOP.
    ev_rest = lv_rest.
  ENDMETHOD.

  METHOD header.
    DATA ls_hdr TYPE ihttpnvp.

    READ TABLE it_headers INTO ls_hdr WITH KEY name = to_lower( iv_name ).
    IF sy-subrc = 0.
      rv_value = ls_hdr-value.
    ENDIF.
  ENDMETHOD.

  METHOD parse_request.
    DATA lt_part_headers TYPE tihttpnvp.
    DATA lv_http         TYPE string.
    DATA lt_lines        TYPE string_table.
    DATA lv_line         TYPE string.
    DATA lv_version      TYPE string.
    DATA lv_rest         TYPE string.

* part headers (Content-Type: application/http ...), blank line, then the
* embedded HTTP request
    split_headers( EXPORTING iv_chunk   = iv_chunk
                   IMPORTING et_headers = lt_part_headers
                             ev_rest    = lv_http ).

    SPLIT lv_http AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    READ TABLE lt_lines INDEX 1 INTO lv_line.
    IF sy-subrc <> 0 OR lv_line IS INITIAL.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 400
          code    = 'STG/BAD_BATCH'
          message = 'Batch part without a request line'.
    ENDIF.
    SPLIT lv_line AT space INTO rs_request-method rs_request-url lv_version.
    rs_request-method = to_upper( rs_request-method ).
    IF rs_request-method IS INITIAL OR rs_request-url IS INITIAL.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 400
          code    = 'STG/BAD_BATCH'
          message = |Bad request line in batch: { lv_line }|.
    ENDIF.

    DELETE lt_lines INDEX 1.
    CLEAR lv_rest.
    LOOP AT lt_lines INTO lv_line.
      IF lv_rest IS INITIAL.
        lv_rest = lv_line.
      ELSE.
        lv_rest = lv_rest && cl_abap_char_utilities=>newline && lv_line.
      ENDIF.
    ENDLOOP.
    split_headers( EXPORTING iv_chunk   = lv_rest
                   IMPORTING et_headers = rs_request-headers
                             ev_rest    = rs_request-body ).
    SHIFT rs_request-body RIGHT DELETING TRAILING cl_abap_char_utilities=>newline.
    CONDENSE rs_request-body.
  ENDMETHOD.

  METHOD parse.
    DATA lt_chunks    TYPE string_table.
    DATA lv_chunk     TYPE string.
    DATA lt_headers   TYPE tihttpnvp.
    DATA lv_rest      TYPE string.
    DATA lv_type      TYPE string.
    DATA lv_boundary  TYPE string.
    DATA lt_inner     TYPE string_table.
    DATA lv_inner     TYPE string.
    DATA ls_part      TYPE ty_part.

    IF iv_boundary IS INITIAL.
      RAISE EXCEPTION TYPE zcx_stg_error
        EXPORTING
          status  = 400
          code    = 'STG/BAD_BATCH'
          message = 'Content-Type of a $batch request must carry a boundary'.
    ENDIF.

    lt_chunks = chunks( iv_body     = iv_body
                        iv_boundary = iv_boundary ).
    LOOP AT lt_chunks INTO lv_chunk.
      CLEAR ls_part.
      split_headers( EXPORTING iv_chunk   = lv_chunk
                     IMPORTING et_headers = lt_headers
                               ev_rest    = lv_rest ).
      lv_type = header( it_headers = lt_headers
                        iv_name    = 'content-type' ).
      IF lv_type CS 'multipart/mixed'.
        ls_part-changeset = abap_true.
        lv_boundary = boundary_of( lv_type ).
        lt_inner = chunks( iv_body     = lv_rest
                           iv_boundary = lv_boundary ).
        LOOP AT lt_inner INTO lv_inner.
          APPEND parse_request( lv_inner ) TO ls_part-requests.
        ENDLOOP.
      ELSE.
        APPEND parse_request( lv_chunk ) TO ls_part-requests.
      ENDIF.
      APPEND ls_part TO rt_parts.
    ENDLOOP.
  ENDMETHOD.

  METHOD run_request.
    DATA lv_url     TYPE string.
    DATA lv_path    TYPE string.
    DATA lv_query   TYPE string.
    DATA lt_options TYPE tihttpnvp.
    DATA lv_off     TYPE i.

    lv_url = is_request-url.
    IF lv_url CP 'http://*' OR lv_url CP 'https://*'.
      FIND FIRST OCCURRENCE OF '/sap/opu/' IN lv_url MATCH OFFSET lv_off.
      IF sy-subrc = 0.
        lv_url = lv_url+lv_off.
      ENDIF.
    ENDIF.
    IF lv_url CP '/*'.
      lv_path = lv_url.
    ELSE.
      lv_path = |{ iv_service_path }/{ lv_url }|.
    ENDIF.
    SPLIT lv_path AT '?' INTO lv_path lv_query.
    IF lv_query IS NOT INITIAL.
      lt_options = cl_http_utility=>string_to_fields( lv_query ).
    ENDIF.

    rs_response = zcl_stg_dispatcher=>dispatch( iv_method  = is_request-method
                                                iv_path    = lv_path
                                                it_options = lt_options
                                                iv_host    = iv_host
                                                iv_body    = is_request-body ).
  ENDMETHOD.

  METHOD byte_length.
    DATA lv_x TYPE xstring.

    TRY.
        lv_x = cl_abap_codepage=>convert_to( iv_string ).
        rv_len = xstrlen( lv_x ).
      CATCH cx_root.
        rv_len = strlen( iv_string ).
    ENDTRY.
  ENDMETHOD.

  METHOD format_part.
    DATA lv_crlf TYPE string.
    DATA ls_hdr  TYPE ihttpnvp.

    lv_crlf = cl_abap_char_utilities=>cr_lf.
    rv_string = |Content-Type: application/http{ lv_crlf }Content-Transfer-Encoding: binary{ lv_crlf }{ lv_crlf }| &&
                |HTTP/1.1 { is_response-status } { is_response-reason }{ lv_crlf }|.
    IF is_response-content_type IS NOT INITIAL.
      rv_string = rv_string && |Content-Type: { is_response-content_type }{ lv_crlf }|.
    ENDIF.
    rv_string = rv_string && |Content-Length: { byte_length( is_response-body ) }{ lv_crlf }| &&
                |DataServiceVersion: 2.0{ lv_crlf }|.
    LOOP AT is_response-headers INTO ls_hdr.
      rv_string = rv_string && |{ ls_hdr-name }: { ls_hdr-value }{ lv_crlf }|.
    ENDLOOP.
    rv_string = rv_string && lv_crlf && is_response-body && lv_crlf.
  ENDMETHOD.

  METHOD handle.
    DATA lt_parts     TYPE ty_parts.
    DATA ls_part      TYPE ty_part.
    DATA ls_request   TYPE ty_request.
    DATA ls_response  TYPE zcl_stg_dispatcher=>ty_response.
    DATA lv_boundary  TYPE string.
    DATA lv_cs        TYPE string.
    DATA lv_crlf      TYPE string.
    DATA lv_out       TYPE string.
    DATA lv_cs_out    TYPE string.
    DATA lv_failed    TYPE abap_bool.

    lv_crlf = cl_abap_char_utilities=>cr_lf.
    lt_parts = parse( iv_body     = iv_body
                      iv_boundary = boundary_of( iv_content_type ) ).

    gv_counter = gv_counter + 1.
    lv_boundary = |batchresponse_stg_{ gv_counter }|.

    LOOP AT lt_parts INTO ls_part.
      IF ls_part-changeset = abap_true.
        gv_counter = gv_counter + 1.
        lv_cs = |changesetresponse_stg_{ gv_counter }|.
        CLEAR lv_cs_out.
        lv_failed = abap_false.
        LOOP AT ls_part-requests INTO ls_request.
          ls_response = run_request( is_request      = ls_request
                                     iv_service_path = iv_service_path
                                     iv_host         = iv_host ).
          IF ls_response-status >= 400.
* the changeset fails as a whole: one error part instead of the multipart
            lv_failed = abap_true.
            lv_out = lv_out && |--{ lv_boundary }{ lv_crlf }| && format_part( ls_response ).
            EXIT.
          ENDIF.
          lv_cs_out = lv_cs_out && |--{ lv_cs }{ lv_crlf }| && format_part( ls_response ).
        ENDLOOP.
        IF lv_failed = abap_false.
          lv_out = lv_out && |--{ lv_boundary }{ lv_crlf }Content-Type: multipart/mixed; boundary={ lv_cs }{ lv_crlf }{ lv_crlf }| &&
                   lv_cs_out && |--{ lv_cs }--{ lv_crlf }|.
        ENDIF.
      ELSE.
        READ TABLE ls_part-requests INDEX 1 INTO ls_request.
        ls_response = run_request( is_request      = ls_request
                                   iv_service_path = iv_service_path
                                   iv_host         = iv_host ).
        lv_out = lv_out && |--{ lv_boundary }{ lv_crlf }| && format_part( ls_response ).
      ENDIF.
    ENDLOOP.
    lv_out = lv_out && |--{ lv_boundary }--{ lv_crlf }|.

    rs_response-status       = 202.
    rs_response-reason       = 'Accepted'.
    rs_response-content_type = |multipart/mixed; boundary={ lv_boundary }|.
    rs_response-body         = lv_out.
  ENDMETHOD.

ENDCLASS.
