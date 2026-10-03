"! A3b: loopback browser handoff. Tickets are never validated credentials.
"! Kernel UUID randomness is not a CSPRNG; do not start trusting this ticket.
CLASS zcl_osd_adt_reentrance DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS target IMPORTING iv_target TYPE string EXPORTING ev_url TYPE string ev_error TYPE string.
    CLASS-METHODS serialize IMPORTING iv_query TYPE string iv_stamp TYPE string iv_ticket TYPE string
      RETURNING VALUE(rv_query) TYPE string.
    CLASS-METHODS negotiate IMPORTING iv_accept TYPE string RETURNING VALUE(rv_type) TYPE string.
    CLASS-METHODS unix_ms IMPORTING iv_stamp TYPE timestampl RETURNING VALUE(rv_ms) TYPE string.
    CLASS-METHODS html IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_priority, q TYPE f, spec TYPE i, idx TYPE i, END OF ty_priority.
    CLASS-METHODS priority IMPORTING iv_accept TYPE string iv_subtype TYPE string RETURNING VALUE(rs_priority) TYPE ty_priority.
    CLASS-METHODS split IMPORTING iv_text TYPE string iv_delimiter TYPE string RETURNING VALUE(rt_parts) TYPE string_table.
    CLASS-METHODS quality IMPORTING iv_text TYPE string RETURNING VALUE(rv_q) TYPE f.
    CLASS-METHODS decode_form IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS form IMPORTING iv_text TYPE string RETURNING VALUE(rv_text) TYPE string.
    CLASS-METHODS pairs IMPORTING iv_query TYPE string RETURNING VALUE(rt_pairs) TYPE zif_osd_adt_route=>tt_param.
    CLASS-METHODS outer IMPORTING iv_uri TYPE string EXPORTING ev_target TYPE string ev_stamp TYPE string.
    CLASS-METHODS ticket RETURNING VALUE(rv_ticket) TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS suffix IMPORTING iv_suffix TYPE string RETURNING VALUE(rv_ok) TYPE abap_bool.
ENDCLASS.
CLASS zcl_osd_adt_reentrance IMPLEMENTATION.
  METHOD target.
    DATA lv_scheme TYPE string.
    DATA lv_authority TYPE string.
    DATA lv_suffix TYPE string.
    DATA lv_host TYPE string.
    DATA lv_port TYPE string.
    DATA lv_number TYPE i.
    CLEAR: ev_url, ev_error.
    ev_error = `redirect-url is not a URL`.
    FIND REGEX `^(https?)://([^/?#]+)(.*)$` IN iv_target IGNORING CASE
      SUBMATCHES lv_scheme lv_authority lv_suffix.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    FIND REGEX `^(\[[^\]]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?$` IN lv_authority
      SUBMATCHES lv_host lv_port.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_host = to_lower( lv_host ).
    IF lv_host <> `localhost` AND lv_host <> `127.0.0.1` AND lv_host <> `[::1]`.
      ev_error = `redirect-url must point at loopback`.
      RETURN.
    ENDIF.
    IF suffix( lv_suffix ) = abap_false.
      RETURN.
    ENDIF.
    lv_scheme = to_lower( lv_scheme ).
    IF lv_port IS NOT INITIAL.
      lv_number = substring( val = lv_port off = 1 ).
      IF lv_number > 65535.
        RETURN.
      ENDIF.
      CLEAR lv_port.
      IF NOT ( lv_scheme = `http` AND lv_number = 80 ) AND NOT ( lv_scheme = `https` AND lv_number = 443 ).
        lv_port = |:{ lv_number }|.
      ENDIF.
    ENDIF.
    IF lv_suffix IS INITIAL OR lv_suffix(1) = `?` OR lv_suffix(1) = `#`.
      lv_suffix = `/` && lv_suffix.
    ENDIF.
    ev_url = lv_scheme && `://` && lv_host && lv_port && lv_suffix.
    CLEAR ev_error.
  ENDMETHOD.
  METHOD suffix.
    DATA lv_path TYPE string.
    DATA lv_tail TYPE string.
    DATA lt_segments TYPE string_table.
    DATA lv_segment TYPE string.
    FIND REGEX `^([^?#]*)(.*)$` IN iv_suffix SUBMATCHES lv_path lv_tail.
    FIND REGEX `^(/([A-Za-z0-9._~!$&'()*+,;=:@-]|%[0-9a-f]{2})*)*$` IN lv_path IGNORING CASE.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    FIND REGEX `^(\?([A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*)?(#([A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*)?$`
      IN lv_tail IGNORING CASE.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    SPLIT to_lower( lv_path ) AT `/` INTO TABLE lt_segments.
    LOOP AT lt_segments INTO lv_segment.
      REPLACE ALL OCCURRENCES OF `%2e` IN lv_segment WITH `.`.
      IF lv_segment = `.` OR lv_segment = `..`.
        RETURN.
      ENDIF.
    ENDLOOP.
    rv_ok = abap_true.
  ENDMETHOD.
  METHOD pairs.
    DATA lt_parts TYPE string_table.
    DATA lv_part TYPE string.
    DATA ls_pair TYPE zif_osd_adt_route=>ty_param.
    DATA lv_off TYPE i.
    SPLIT iv_query AT `&` INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      IF lv_part IS INITIAL.
        CONTINUE.
      ENDIF.
      CLEAR ls_pair.
      FIND `=` IN lv_part MATCH OFFSET lv_off.
      IF sy-subrc = 0.
        ls_pair-name = lv_part(lv_off).
        lv_off = lv_off + 1.
        ls_pair-value = substring( val = lv_part off = lv_off ).
      ELSE.
        ls_pair-name = lv_part.
      ENDIF.
      REPLACE ALL OCCURRENCES OF `+` IN ls_pair-name WITH ` `.
      REPLACE ALL OCCURRENCES OF `+` IN ls_pair-value WITH ` `.
      ls_pair-name = decode_form( ls_pair-name ).
      ls_pair-value = decode_form( ls_pair-value ).
      APPEND ls_pair TO rt_pairs.
    ENDLOOP.
  ENDMETHOD.
  METHOD decode_form.
    DATA lv_ok TYPE abap_bool.
    DATA lv_bytes TYPE xstring.
    DATA lv_char TYPE string.
    DATA lv_hex TYPE c LENGTH 2.
    DATA lv_one TYPE x LENGTH 1.
    DATA lv_off TYPE i.
    DATA lv_byte TYPE i.
    DATA lv_width TYPE i.
    DATA lv_used TYPE i.
    DATA lv_next TYPE i.
    DATA lv_min TYPE i.
    DATA lv_max TYPE i.
    DATA lv_piece TYPE string.
    DATA lv_chunk TYPE xstring.
    DATA lv_replacement TYPE string.
    zcl_osd_adt_uri=>decode_component( EXPORTING iv_text = iv_text IMPORTING ev_text = rv_text ev_ok = lv_ok ).
    IF lv_ok = abap_true.
      RETURN.
    ENDIF.
    WHILE lv_off < strlen( iv_text ).
      lv_char = iv_text+lv_off(1).
      IF lv_char = `%` AND lv_off + 2 < strlen( iv_text ).
        lv_hex = to_upper( substring( val = iv_text off = lv_off + 1 len = 2 ) ).
        IF lv_hex CO `0123456789ABCDEF`.
          lv_one = lv_hex.
          CONCATENATE lv_bytes lv_one INTO lv_bytes IN BYTE MODE.
          lv_off = lv_off + 3.
          CONTINUE.
        ENDIF.
      ENDIF.
      lv_bytes = lv_bytes && cl_abap_codepage=>convert_to( lv_char ).
      lv_off = lv_off + 1.
    ENDWHILE.
    CLEAR: rv_text, lv_off.
    lv_replacement = cl_abap_codepage=>convert_from( 'EFBFBD' ).
    WHILE lv_off < xstrlen( lv_bytes ).
      lv_byte = lv_bytes+lv_off(1).
      lv_width = 1.
      IF lv_byte >= 194 AND lv_byte <= 223.
        lv_width = 2.
      ELSEIF lv_byte >= 224 AND lv_byte <= 239.
        lv_width = 3.
      ELSEIF lv_byte >= 240 AND lv_byte <= 244.
        lv_width = 4.
      ELSEIF lv_byte >= 128.
        rv_text = rv_text && lv_replacement.
        lv_off = lv_off + 1.
        CONTINUE.
      ENDIF.
      lv_used = 1.
      lv_min = 128.
      lv_max = 191.
      CASE lv_byte.
        WHEN 224.
          lv_min = 160.
        WHEN 237.
          lv_max = 159.
        WHEN 240.
          lv_min = 144.
        WHEN 244.
          lv_max = 143.
      ENDCASE.
      WHILE lv_used < lv_width AND lv_off + lv_used < xstrlen( lv_bytes ).
        " The next byte must belong to this scalar, not a new lead byte.
        lv_next = lv_off + lv_used.
        lv_byte = lv_bytes+lv_next(1).
        IF lv_byte < lv_min OR lv_byte > lv_max.
          EXIT.
        ENDIF.
        lv_used = lv_used + 1.
        lv_min = 128.
        lv_max = 191.
      ENDWHILE.
      IF lv_used = lv_width.
        lv_chunk = lv_bytes+lv_off(lv_width).
        lv_piece = cl_abap_codepage=>convert_from( lv_chunk ).
      ELSE.
        lv_piece = lv_replacement.
      ENDIF.
      rv_text = rv_text && lv_piece.
      lv_off = lv_off + lv_used.
    ENDWHILE.
  ENDMETHOD.
  METHOD form.
    rv_text = zcl_osd_adt_uri=>encode_component( iv_text ).
    REPLACE ALL OCCURRENCES OF `%20` IN rv_text WITH `+`.
    REPLACE ALL OCCURRENCES OF `!` IN rv_text WITH `%21`.
    REPLACE ALL OCCURRENCES OF `'` IN rv_text WITH `%27`.
    REPLACE ALL OCCURRENCES OF `(` IN rv_text WITH `%28`.
    REPLACE ALL OCCURRENCES OF `)` IN rv_text WITH `%29`.
    REPLACE ALL OCCURRENCES OF `~` IN rv_text WITH `%7E`.
  ENDMETHOD.
  METHOD serialize.
    DATA lt_pairs TYPE zif_osd_adt_route=>tt_param.
    DATA ls_pair LIKE LINE OF lt_pairs.
    DATA lv_stamp TYPE abap_bool.
    DATA lv_ticket TYPE abap_bool.
    lt_pairs = pairs( iv_query ).
    LOOP AT lt_pairs INTO ls_pair.
      IF ls_pair-name = `_`.
        IF lv_stamp = abap_true.
          CONTINUE.
        ENDIF.
        ls_pair-value = iv_stamp.
        lv_stamp = abap_true.
      ELSEIF ls_pair-name = `reentrance-ticket`.
        IF lv_ticket = abap_true.
          CONTINUE.
        ENDIF.
        ls_pair-value = iv_ticket.
        lv_ticket = abap_true.
      ENDIF.
      IF rv_query IS NOT INITIAL.
        rv_query = rv_query && `&`.
      ENDIF.
      rv_query = rv_query && form( ls_pair-name ) && `=` && form( ls_pair-value ).
    ENDLOOP.
    IF lv_stamp = abap_false.
      IF rv_query IS NOT INITIAL.
        rv_query = rv_query && `&`.
      ENDIF.
      rv_query = rv_query && `_=` && form( iv_stamp ).
    ENDIF.
    IF lv_ticket = abap_false.
      rv_query = rv_query && `&reentrance-ticket=` && form( iv_ticket ).
    ENDIF.
  ENDMETHOD.
  METHOD outer.
    DATA lv_off TYPE i.
    DATA lv_query TYPE string.
    DATA lt_pairs TYPE zif_osd_adt_route=>tt_param.
    DATA ls_pair LIKE LINE OF lt_pairs.
    DATA lv_count TYPE i.
    DATA lv_seen TYPE abap_bool.
    DATA lv_now TYPE timestampl.

    FIND `?` IN iv_uri MATCH OFFSET lv_off.
    IF sy-subrc = 0.
      lv_off = lv_off + 1.
      lv_query = substring( val = iv_uri off = lv_off ).
    ENDIF.
    lt_pairs = pairs( lv_query ).
    LOOP AT lt_pairs INTO ls_pair.
      IF ls_pair-name = `redirect-url`.
        lv_count = lv_count + 1.
        ev_target = ls_pair-value.
      ELSEIF ls_pair-name CP `redirect-url[*`.
        lv_count = lv_count + 2.
      ELSEIF ls_pair-name = `_`.
        IF lv_seen = abap_true.
          ev_stamp = ev_stamp && `,`.
        ENDIF.
        ev_stamp = ev_stamp && ls_pair-value.
        lv_seen = abap_true.
      ELSEIF ls_pair-name CP `_[*`.
        ev_stamp = `[object Object]`.
        lv_seen = abap_true.
      ENDIF.
    ENDLOOP.
    IF lv_count <> 1.
      CLEAR ev_target.
    ENDIF.
    IF lv_seen = abap_false.
      GET TIME STAMP FIELD lv_now.
      ev_stamp = unix_ms( lv_now ).
    ENDIF.
  ENDMETHOD.
  METHOD unix_ms.
    DATA lv_text TYPE string.
    DATA lv_date TYPE d.
    DATA lv_time TYPE t.
    DATA lv_epoch TYPE d VALUE '19700101'.
    DATA lv_midnight TYPE t VALUE '000000'.
    DATA lv_days TYPE p LENGTH 8 DECIMALS 0.
    DATA lv_seconds TYPE i.
    DATA lv_fraction TYPE i.
    DATA lv_ms TYPE p LENGTH 16 DECIMALS 0.
    " GET TIME STAMP is UTC; read its decimal digits without a float cast.
    lv_text = |{ iv_stamp NUMBER = RAW }|.
    lv_date = lv_text(8).
    lv_time = substring( val = lv_text off = 8 len = 6 ).
    lv_fraction = substring( val = lv_text off = 15 len = 3 ).
    lv_days = lv_date - lv_epoch.
    lv_seconds = lv_time - lv_midnight.
    lv_ms = lv_days * 86400000 + lv_seconds * 1000 + lv_fraction.
    rv_ms = |{ lv_ms NUMBER = RAW }|.
  ENDMETHOD.
  METHOD html.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF `&` IN rv_text WITH `&amp;`.
    REPLACE ALL OCCURRENCES OF `<` IN rv_text WITH `&lt;`.
    REPLACE ALL OCCURRENCES OF `>` IN rv_text WITH `&gt;`.
    REPLACE ALL OCCURRENCES OF `"` IN rv_text WITH `&quot;`.
    REPLACE ALL OCCURRENCES OF `'` IN rv_text WITH `&#39;`.
  ENDMETHOD.
  METHOD ticket.
    DATA lv_a TYPE sysuuid_x16.
    DATA lv_b TYPE sysuuid_x16.
    DATA lv_bytes TYPE xstring.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    TRY.
        lv_a = cl_system_uuid=>create_uuid_x16_static( ).
        lv_b = cl_system_uuid=>create_uuid_x16_static( ).
        CONCATENATE lv_a lv_b(8) INTO lv_bytes IN BYTE MODE.
        rv_ticket = cl_http_utility=>encode_x_base64( lv_bytes ).
        REPLACE ALL OCCURRENCES OF `+` IN rv_ticket WITH `-`.
        REPLACE ALL OCCURRENCES OF `/` IN rv_ticket WITH `_`.
      CATCH cx_uuid_error.
        lx_error = zcx_osd_adt=>internal( `could not generate reentrance ticket` ).
        RAISE EXCEPTION lx_error.
    ENDTRY.
  ENDMETHOD.
  METHOD split.
    DATA lv_quoted TYPE abap_bool.
    DATA lv_char TYPE string.
    DATA lv_part TYPE string.
    DATA lv_off TYPE i.
    DO strlen( iv_text ) TIMES.
      lv_off = sy-index - 1.
      lv_char = iv_text+lv_off(1).
      IF lv_char = `"`.
        lv_quoted = boolc( lv_quoted = abap_false ).
      ENDIF.
      IF lv_char = iv_delimiter AND lv_quoted = abap_false.
        APPEND lv_part TO rt_parts.
        CLEAR lv_part.
      ELSE.
        lv_part = lv_part && lv_char.
      ENDIF.
    ENDDO.
    APPEND lv_part TO rt_parts.
  ENDMETHOD.
  METHOD quality.
    DATA lv_text TYPE string.
    DATA lv_number TYPE string.
    DATA lv_length TYPE i.
    DATA lv_last TYPE i.
    lv_text = zcl_osd_adt_js=>trim( iv_text ).
    lv_last = strlen( lv_text ) - 1.
    IF lv_last > 0 AND lv_text(1) = `"` AND lv_text+lv_last(1) = `"`.
      lv_text = substring( val = lv_text off = 1 len = lv_last - 1 ).
    ENDIF.
    FIND REGEX `^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?` IN lv_text MATCH LENGTH lv_length.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    lv_number = lv_text(lv_length).
    TRY.
        rv_q = lv_number.
      CATCH cx_sy_conversion_no_number cx_sy_conversion_overflow.
        CLEAR rv_q.
    ENDTRY.
  ENDMETHOD.
  METHOD priority.
    DATA lt_ranges TYPE string_table.
    DATA lt_parts TYPE string_table.
    DATA lv_range TYPE string.
    DATA lv_media TYPE string.
    DATA lv_type TYPE string.
    DATA lv_subtype TYPE string.
    DATA lv_param TYPE string.
    DATA lv_key TYPE string.
    DATA lv_value TYPE string.
    DATA lv_off TYPE i.
    DATA lv_match TYPE abap_bool.
    DATA ls_priority TYPE ty_priority.
    rs_priority-spec = -1.
    lt_ranges = split( iv_text = iv_accept iv_delimiter = `,` ).
    LOOP AT lt_ranges INTO lv_range.
      ls_priority-idx = sy-tabix.
      ls_priority-q = 1.
      ls_priority-spec = 0.
      lt_parts = split( iv_text = lv_range iv_delimiter = `;` ).
      READ TABLE lt_parts INDEX 1 INTO lv_media.
      lv_media = to_lower( zcl_osd_adt_js=>trim( lv_media ) ).
      FIND REGEX `^([^ /]+)/([^ /]+)$` IN lv_media SUBMATCHES lv_type lv_subtype.
      IF sy-subrc <> 0 OR ( lv_type <> `text` AND lv_type <> `*` )
        OR ( lv_subtype <> iv_subtype AND lv_subtype <> `*` ).
        CONTINUE.
      ENDIF.
      IF lv_type = `text`.
        ls_priority-spec = 4.
      ENDIF.
      IF lv_subtype = iv_subtype.
        ls_priority-spec = ls_priority-spec + 2.
      ENDIF.
      lv_match = abap_true.
      LOOP AT lt_parts INTO lv_param FROM 2.
        FIND `=` IN lv_param MATCH OFFSET lv_off.
        IF sy-subrc <> 0.
          CONTINUE.
        ENDIF.
        lv_key = to_lower( zcl_osd_adt_js=>trim( substring( val = lv_param len = lv_off ) ) ).
        lv_value = zcl_osd_adt_js=>trim( substring( val = lv_param off = lv_off + 1 ) ).
        IF lv_key = `q`.
          ls_priority-q = quality( lv_value ).
          EXIT.
        ENDIF.
        REPLACE ALL OCCURRENCES OF `"` IN lv_value WITH ``.
        IF lv_value <> `*` AND lv_value IS NOT INITIAL.
          lv_match = abap_false.
        ENDIF.
        " Parameters add one specificity bit, however many there are.
        IF ls_priority-spec MOD 2 = 0.
          ls_priority-spec = ls_priority-spec + 1.
        ENDIF.
      ENDLOOP.
      IF lv_match = abap_true AND ( ls_priority-spec > rs_priority-spec
        OR ( ls_priority-spec = rs_priority-spec AND ls_priority-q > rs_priority-q ) ).
        rs_priority = ls_priority.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD negotiate.
    DATA ls_plain TYPE ty_priority.
    DATA ls_html TYPE ty_priority.
    IF iv_accept IS INITIAL.
      rv_type = `text/plain`.
      RETURN.
    ENDIF.
    ls_plain = priority( iv_accept = iv_accept iv_subtype = `plain` ).
    ls_html = priority( iv_accept = iv_accept iv_subtype = `html` ).
    IF ls_plain-q <= 0 AND ls_html-q <= 0.
      RETURN.
    ENDIF.
    rv_type = `text/plain`.
    IF ls_html-q > ls_plain-q OR ( ls_html-q = ls_plain-q AND ls_html-spec > ls_plain-spec )
      OR ( ls_html-q = ls_plain-q AND ls_html-spec = ls_plain-spec AND ls_html-idx < ls_plain-idx ).
      rv_type = `text/html`.
    ENDIF.
  ENDMETHOD.
  METHOD zif_osd_adt_route~handle.
    DATA lv_target TYPE string.
    DATA lv_stamp TYPE string.
    DATA lv_url TYPE string.
    DATA lv_error TYPE string.
    DATA lv_query TYPE string.
    DATA lv_fragment TYPE string.
    DATA lv_off TYPE i.
    DATA lv_accept TYPE string VALUE `*/*`.
    DATA lv_type TYPE string.
    DATA ls_header TYPE ihttpnvp.
    DATA ls_identity TYPE zcl_osd_adt_host=>ty_identity.
    zcl_osd_adt_host=>require( `SYSTEM` ).
    outer( EXPORTING iv_uri = is_request-uri IMPORTING ev_target = lv_target ev_stamp = lv_stamp ).
    lv_error = `redirect-url is required`.
    IF lv_target IS NOT INITIAL.
      target( EXPORTING iv_target = lv_target IMPORTING ev_url = lv_url ev_error = lv_error ).
    ENDIF.
    IF lv_error IS NOT INITIAL.
      rs_response-status = 400.
      rs_response-content_type = `text/plain; charset=utf-8`.
      rs_response-body = lv_error.
      RETURN.
    ENDIF.
    FIND `#` IN lv_url MATCH OFFSET lv_off.
    IF sy-subrc = 0.
      lv_fragment = substring( val = lv_url off = lv_off ).
      lv_url = lv_url(lv_off).
    ENDIF.
    FIND `?` IN lv_url MATCH OFFSET lv_off.
    IF sy-subrc = 0.
      lv_query = substring( val = lv_url off = lv_off + 1 ).
      lv_url = lv_url(lv_off).
    ENDIF.
    lv_url = lv_url && `?` && serialize( iv_query = lv_query iv_stamp = lv_stamp iv_ticket = ticket( ) ) && lv_fragment.
    LOOP AT is_request-headers INTO ls_header.
      IF to_lower( ls_header-name ) = `accept`.
        lv_accept = ls_header-value.
      ENDIF.
    ENDLOOP.
    lv_type = negotiate( lv_accept ).
    rs_response-status = 307.
    IF lv_type IS NOT INITIAL.
      rs_response-content_type = lv_type && `; charset=utf-8`.
      IF lv_type = `text/plain`.
        rs_response-body = `Temporary Redirect. Redirecting to ` && lv_url.
      ELSE.
        rs_response-body = `<p>Temporary Redirect. Redirecting to ` && html( lv_url ) && `</p>`.
      ENDIF.
    ENDIF.
    ls_header-name = `location`.
    ls_header-value = lv_url.
    APPEND ls_header TO rs_response-headers.
    ls_header-name = `vary`.
    ls_header-value = `Accept`.
    APPEND ls_header TO rs_response-headers.
    ls_identity = zcl_osd_adt_host=>identity( ).
    ls_header-name = `set-cookie`.
    ls_header-value = `sap-usercontext=sap-client%3D` && zcl_osd_adt_uri=>encode_component( ls_identity-client ) && `; Path=/`.
    APPEND ls_header TO rs_response-headers.
  ENDMETHOD.
ENDCLASS.
