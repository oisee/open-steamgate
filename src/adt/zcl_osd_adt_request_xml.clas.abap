"! Shared ADT request XML reader. Only expanded names cross this boundary.
"! No DTD, no resolver, at most 64 elements deep and 16 MiB of input.
"! Strict tokenizer; no sXML dependency. Consumers use expanded-name data.
CLASS zcl_osd_adt_request_xml DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_body_limit TYPE i VALUE 16777216.
    CONSTANTS c_depth_limit TYPE i VALUE 64.
    CLASS-METHODS profile IMPORTING iv_method TYPE string iv_path TYPE string
      RETURNING VALUE(rv_profile) TYPE string.
    CLASS-METHODS read IMPORTING iv_body TYPE xstring iv_profile TYPE string OPTIONAL
      RETURNING VALUE(rv_tokens) TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS parse IMPORTING iv_body TYPE xstring iv_profile TYPE string OPTIONAL
      RETURNING VALUE(rt_elements) TYPE zif_osd_adt_xml=>tt_element RAISING zcx_osd_adt.
    CLASS-METHODS attribute IMPORTING is_element TYPE zif_osd_adt_xml=>ty_element iv_uri TYPE string DEFAULT `` iv_local TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS prepare IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
      RETURNING VALUE(rs_request) TYPE zif_osd_adt_route=>ty_request RAISING zcx_osd_adt.
  PRIVATE SECTION.
    CONSTANTS c_ascii TYPE string VALUE ` !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_``abcdefghijklmnopqrstuvwxyz{|}~`.
    TYPES: BEGIN OF ty_binding, prefix TYPE string, uri TYPE string, END OF ty_binding.
    TYPES tt_binding TYPE HASHED TABLE OF ty_binding WITH UNIQUE KEY prefix.
    TYPES: BEGIN OF ty_undo, prefix TYPE string, uri TYPE string, existed TYPE abap_bool, END OF ty_undo.
    TYPES tt_undo TYPE STANDARD TABLE OF ty_undo WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_expanded, uri TYPE string, local TYPE string, END OF ty_expanded.
    TYPES tt_expanded TYPE HASHED TABLE OF ty_expanded WITH UNIQUE KEY uri local.
    TYPES tt_seen TYPE HASHED TABLE OF string WITH UNIQUE KEY table_line.
    TYPES: BEGIN OF ty_frame, id TYPE i, raw TYPE string, canonical TYPE string, undo TYPE tt_undo, END OF ty_frame.
    TYPES: BEGIN OF ty_raw, name TYPE string, value TYPE string, END OF ty_raw.
    TYPES tt_raw TYPE STANDARD TABLE OF ty_raw WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_lexical, raw TYPE string, prefix TYPE string, local TYPE string, END OF ty_lexical.
    TYPES tt_lexical TYPE HASHED TABLE OF ty_lexical WITH UNIQUE KEY raw.
    DATA mt_lexical TYPE tt_lexical.
    DATA mv_text TYPE string.
    DATA mv_pos TYPE i.
    DATA mv_tokens TYPE string.
    DATA mt_stack TYPE STANDARD TABLE OF ty_frame WITH DEFAULT KEY.
    DATA mt_bindings TYPE tt_binding.
    DATA mt_elements TYPE zif_osd_adt_xml=>tt_element.
    METHODS run IMPORTING iv_body TYPE xstring iv_profile TYPE string
      RETURNING VALUE(rt_elements) TYPE zif_osd_adt_xml=>tt_element RAISING zcx_osd_adt.
    METHODS space RETURNING VALUE(rv_found) TYPE abap_bool.
    METHODS starts IMPORTING iv_value TYPE string RETURNING VALUE(rv_found) TYPE abap_bool.
    METHODS expect IMPORTING iv_value TYPE string RAISING zcx_osd_adt.
    METHODS until IMPORTING iv_end TYPE string RETURNING VALUE(rv_text) TYPE string RAISING zcx_osd_adt.
    METHODS scan_name RETURNING VALUE(rv_name) TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS codepoint IMPORTING iv_text TYPE string CHANGING cv_pos TYPE i RETURNING VALUE(rv_cp) TYPE i RAISING zcx_osd_adt.
    CLASS-METHODS name_start IMPORTING iv_cp TYPE i RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS name_char IMPORTING iv_cp TYPE i RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS ncname IMPORTING iv_name TYPE string RAISING zcx_osd_adt.
    METHODS split_name IMPORTING iv_name TYPE string EXPORTING ev_prefix TYPE string ev_local TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS valid_char IMPORTING iv_cp TYPE i RETURNING VALUE(rv_ok) TYPE abap_bool.
    CLASS-METHODS decode IMPORTING iv_raw TYPE string RETURNING VALUE(rv_text) TYPE string RAISING zcx_osd_adt.
    METHODS expand IMPORTING iv_raw TYPE string it_bindings TYPE tt_binding iv_attribute TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(rs_name) TYPE zif_osd_adt_xml=>ty_attribute RAISING zcx_osd_adt.
    METHODS restore IMPORTING it_undo TYPE tt_undo.
    METHODS text IMPORTING iv_value TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS prefix IMPORTING iv_uri TYPE string RETURNING VALUE(rv_prefix) TYPE string.
    CLASS-METHODS required IMPORTING iv_name TYPE string RETURNING VALUE(rv_prefix) TYPE string.
    CLASS-METHODS name IMPORTING iv_uri TYPE string iv_name TYPE string
      RETURNING VALUE(rv_name) TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS fail RAISING zcx_osd_adt.
ENDCLASS.
CLASS zcl_osd_adt_request_xml IMPLEMENTATION.
  METHOD fail.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    CREATE OBJECT lx_error EXPORTING iv_status = 400 iv_type = `ExceptionInvalidXML`
      iv_message = `invalid XML request`.
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD prefix.
    CASE iv_uri.
      WHEN `http://www.sap.com/adt/core`.
        rv_prefix = `adtcore`.
      WHEN `http://www.sap.com/adt/checkrun`.
        rv_prefix = `chkrun`.
      WHEN `http://www.sap.com/abapxml`.
        rv_prefix = `asx`.
      WHEN `http://www.sap.com/adt/ris/virtualFolders`.
        rv_prefix = `vfs`.
      WHEN `http://www.sap.com/adt/oo/classes`.
        rv_prefix = `class`.
      WHEN `http://www.sap.com/adt/oo/interfaces`.
        rv_prefix = `intf`.
      WHEN `http://www.sap.com/adt/programs/programs`.
        rv_prefix = `program`.
      WHEN `http://www.sap.com/adt/programs/includes`.
        rv_prefix = `include`.
      WHEN `http://www.sap.com/adt/packages`.
        rv_prefix = `pack`.
      WHEN `http://www.sap.com/adt/aunit`.
        rv_prefix = `aunit`.
      WHEN `http://www.sap.com/adt/ddic/ddlsources`.
        rv_prefix = `ddl`.
      WHEN `http://www.sap.com/adt/ddic/srvd`.
        rv_prefix = `srvd`.
      WHEN `http://www.w3.org/2005/Atom`.
        rv_prefix = `atom`.
      WHEN `http://www.w3.org/XML/1998/namespace`.
        rv_prefix = `xml`.
      WHEN OTHERS.
        IF iv_uri IS NOT INITIAL.
          rv_prefix = `foreign`.
        ENDIF.
    ENDCASE.
  ENDMETHOD.
  METHOD required.
    CASE iv_name.
      WHEN `DATA` OR `URI` OR `DEVCLASS` OR `OPERATION` OR `TV_NODEKEY`.
        rv_prefix = `none`.
      WHEN `objectReferences` OR `objectReference` OR `packageRef`.
        rv_prefix = `adtcore`.
      WHEN `checkObjectList` OR `checkObject` OR `content` OR `artifact`.
        rv_prefix = `chkrun`.
      WHEN `abap` OR `values`.
        rv_prefix = `asx`.
      WHEN `virtualFoldersRequest` OR `preselection` OR `value` OR `facetorder` OR `facet`.
        rv_prefix = `vfs`.
      WHEN `abapClass` OR `abapClassInclude`.
        rv_prefix = `class`.
      WHEN `abapInterface`.
        rv_prefix = `intf`.
      WHEN `abapProgram`.
        rv_prefix = `program`.
      WHEN `abapInclude`.
        rv_prefix = `include`.
      WHEN `package` OR `superPackage`.
        rv_prefix = `pack`.
      WHEN `ddlSource`.
        rv_prefix = `ddl`.
      WHEN `serviceDefinition`.
        rv_prefix = `srvd`.
      WHEN `runConfiguration`.
        rv_prefix = `aunit`.
    ENDCASE.
  ENDMETHOD.
  METHOD name.
    DATA lv_prefix TYPE string.
    lv_prefix = prefix( iv_uri ).
    rv_name = iv_name.
    IF lv_prefix IS NOT INITIAL.
      rv_name = lv_prefix && `:` && iv_name.
    ENDIF.
  ENDMETHOD.
  METHOD profile.
    DATA lv_path TYPE string.
    DATA lv_rest TYPE string.
    IF to_upper( iv_method ) <> `POST`.
      RETURN.
    ENDIF.
    lv_path = to_lower( iv_path ).
    SPLIT lv_path AT `?` INTO lv_path lv_rest.
    REPLACE FIRST OCCURRENCE OF `/sap/bc/adt/` IN lv_path WITH ``.
    REPLACE FIRST OCCURRENCE OF REGEX `/$` IN lv_path WITH ``.
    CASE lv_path.
      WHEN `activation` OR `abapunit/testruns` OR `abapunit/testruns/evaluation`.
        rv_profile = `adtcore,aunit`.
      WHEN `checkruns`.
        rv_profile = `chkrun,adtcore`.
      WHEN `cts/transportchecks` OR `repository/nodestructure`.
        rv_profile = `asx`.
      WHEN `repository/informationsystem/virtualfolders/contents`.
        rv_profile = `vfs`.
      WHEN `oo/classes`.
        rv_profile = `class`.
      WHEN `oo/interfaces`.
        rv_profile = `intf`.
      WHEN `programs/programs`.
        rv_profile = `program`.
      WHEN `programs/includes`.
        rv_profile = `include`.
      WHEN `ddic/ddl/sources`.
        rv_profile = `ddl`.
      WHEN `ddic/srvd/sources`.
        rv_profile = `srvd`.
      WHEN `packages`.
        rv_profile = `pack`.
      WHEN OTHERS.
        FIND REGEX `^oo/classes/[^/]+/includes$` IN lv_path.
        IF sy-subrc = 0.
          rv_profile = `class`.
          RETURN.
        ENDIF.
        FIND REGEX `^(oo/(classes|interfaces)|programs/(programs|includes)|ddic/(ddl|srvd)/sources|packages)/[^/]+$` IN lv_path.
        IF sy-subrc = 0.
          rv_profile = `optional`.
        ENDIF.
    ENDCASE.
  ENDMETHOD.
  METHOD prepare.
    DATA lv_profile TYPE string.
    DATA ls_param TYPE ihttpnvp.
    rs_request = is_request.
    lv_profile = profile( iv_method = is_request-method iv_path = is_request-path ).
    IF lv_profile IS INITIAL.
      RETURN.
    ENDIF.
    IF to_lower( is_request-path ) = `/sap/bc/adt/activation`.
      READ TABLE is_request-query INTO ls_param WITH KEY name = `method`.
      IF sy-subrc <> 0 OR ls_param-value <> `activate`.
        RETURN.
      ENDIF.
    ENDIF.
    IF is_request-body IS INITIAL AND
        ( lv_profile = `optional` OR lv_profile = `vfs` OR lv_profile = `asx` ).
      RETURN.
    ENDIF.
    rs_request-xml = parse( iv_body = is_request-body iv_profile = lv_profile ).
  ENDMETHOD.
  METHOD read.
    DATA lo_parser TYPE REF TO zcl_osd_adt_request_xml.
    DATA lt_elements TYPE zif_osd_adt_xml=>tt_element.
    CREATE OBJECT lo_parser.
    lt_elements = lo_parser->run( iv_body = iv_body iv_profile = iv_profile ).
    rv_tokens = lo_parser->mv_tokens.
  ENDMETHOD.
  METHOD parse.
    DATA lo_parser TYPE REF TO zcl_osd_adt_request_xml.
    CREATE OBJECT lo_parser.
    rt_elements = lo_parser->run( iv_body = iv_body iv_profile = iv_profile ).
  ENDMETHOD.
  METHOD attribute.
    DATA ls_attribute TYPE zif_osd_adt_xml=>ty_attribute.
    READ TABLE is_element-attributes INTO ls_attribute WITH KEY uri = iv_uri local = iv_local.
    rv_value = ls_attribute-value.
  ENDMETHOD.
  METHOD space.
    DATA lv_char TYPE string.
    WHILE mv_pos < strlen( mv_text ).
      lv_char = mv_text+mv_pos(1).
      IF lv_char <> ` ` AND lv_char <> cl_abap_char_utilities=>horizontal_tab
          AND lv_char <> cl_abap_char_utilities=>newline AND lv_char <> cl_abap_char_utilities=>cr_lf(1).
        EXIT.
      ENDIF.
      mv_pos = mv_pos + 1.
      rv_found = abap_true.
    ENDWHILE.
  ENDMETHOD.
  METHOD starts.
    DATA lv_len TYPE i.
    lv_len = strlen( iv_value ).
    IF mv_pos + lv_len <= strlen( mv_text ) AND mv_text+mv_pos(lv_len) = iv_value.
      rv_found = abap_true.
    ENDIF.
  ENDMETHOD.
  METHOD expect.
    IF starts( iv_value ) = abap_false.
      fail( ).
    ENDIF.
    mv_pos = mv_pos + strlen( iv_value ).
  ENDMETHOD.
  METHOD until.
    DATA lv_tail TYPE string.
    DATA lv_off TYPE i.
    lv_tail = substring( val = mv_text off = mv_pos ).
    FIND FIRST OCCURRENCE OF iv_end IN lv_tail MATCH OFFSET lv_off.
    IF sy-subrc <> 0.
      fail( ).
    ENDIF.
    rv_text = lv_tail(lv_off).
    mv_pos = mv_pos + lv_off + strlen( iv_end ).
  ENDMETHOD.
  METHOD codepoint.
    DATA lv_hex TYPE x LENGTH 2.
    DATA lv_low TYPE i.
    DATA lv_unit TYPE c LENGTH 1.
    lv_unit = substring( val = iv_text off = cv_pos len = 1 ).
*   Printable ASCII needs no conversion object; Unicode uses the same path.
    FIND FIRST OCCURRENCE OF lv_unit IN c_ascii MATCH OFFSET rv_cp.
    IF sy-subrc = 0.
      rv_cp = rv_cp + 32.
      cv_pos = cv_pos + 1.
      RETURN.
    ENDIF.
    lv_hex = cl_abap_conv_out_ce=>uccp( lv_unit ).
    rv_cp = lv_hex.
    cv_pos = cv_pos + 1.
    IF rv_cp >= 55296 AND rv_cp <= 56319.
      IF cv_pos >= strlen( iv_text ).
        fail( ).
      ENDIF.
      lv_unit = substring( val = iv_text off = cv_pos len = 1 ).
      lv_hex = cl_abap_conv_out_ce=>uccp( lv_unit ).
      lv_low = lv_hex.
      IF lv_low < 56320 OR lv_low > 57343.
        fail( ).
      ENDIF.
      rv_cp = 65536 + ( rv_cp - 55296 ) * 1024 + lv_low - 56320.
      cv_pos = cv_pos + 1.
    ENDIF.
  ENDMETHOD.
  METHOD name_start.
    rv_ok = boolc( iv_cp = 95 OR ( iv_cp >= 65 AND iv_cp <= 90 ) OR ( iv_cp >= 97 AND iv_cp <= 122 )
      OR ( iv_cp >= 192 AND iv_cp <= 214 ) OR ( iv_cp >= 216 AND iv_cp <= 246 )
      OR ( iv_cp >= 248 AND iv_cp <= 767 ) OR ( iv_cp >= 880 AND iv_cp <= 893 )
      OR ( iv_cp >= 895 AND iv_cp <= 8191 ) OR ( iv_cp >= 8204 AND iv_cp <= 8205 )
      OR ( iv_cp >= 8304 AND iv_cp <= 8591 ) OR ( iv_cp >= 11264 AND iv_cp <= 12271 )
      OR ( iv_cp >= 12289 AND iv_cp <= 55295 ) OR ( iv_cp >= 63744 AND iv_cp <= 64975 )
      OR ( iv_cp >= 65008 AND iv_cp <= 65533 ) OR ( iv_cp >= 65536 AND iv_cp <= 983039 ) ).
  ENDMETHOD.
  METHOD name_char.
    rv_ok = boolc( name_start( iv_cp ) = abap_true OR iv_cp = 45 OR iv_cp = 46
      OR ( iv_cp >= 48 AND iv_cp <= 57 ) OR iv_cp = 183
      OR ( iv_cp >= 768 AND iv_cp <= 879 ) OR ( iv_cp >= 8255 AND iv_cp <= 8256 ) ).
  ENDMETHOD.
  METHOD ncname.
    DATA lv_pos TYPE i.
    DATA lv_cp TYPE i.
    IF iv_name IS INITIAL.
      fail( ).
    ENDIF.
    lv_cp = codepoint( EXPORTING iv_text = iv_name CHANGING cv_pos = lv_pos ).
    IF name_start( lv_cp ) = abap_false.
      fail( ).
    ENDIF.
    WHILE lv_pos < strlen( iv_name ).
      lv_cp = codepoint( EXPORTING iv_text = iv_name CHANGING cv_pos = lv_pos ).
      IF name_char( lv_cp ) = abap_false.
        fail( ).
      ENDIF.
    ENDWHILE.
  ENDMETHOD.
  METHOD split_name.
    DATA lt_parts TYPE string_table.
    DATA ls_lexical TYPE ty_lexical.
*   Cache lexical parts only. Expanded URIs depend on the current scope.
*   The parser instance and this cache live for one document.
    READ TABLE mt_lexical INTO ls_lexical WITH TABLE KEY raw = iv_name.
    IF sy-subrc = 0.
      ev_prefix = ls_lexical-prefix.
      ev_local = ls_lexical-local.
      RETURN.
    ENDIF.
    IF iv_name IS INITIAL OR substring( val = iv_name off = strlen( iv_name ) - 1 ) = `:`.
      fail( ).
    ENDIF.
    SPLIT iv_name AT `:` INTO TABLE lt_parts.
    IF lines( lt_parts ) > 2.
      fail( ).
    ENDIF.
    CLEAR ev_prefix.
    READ TABLE lt_parts INDEX 1 INTO ev_local.
    IF lines( lt_parts ) = 2.
      ev_prefix = ev_local.
      ncname( ev_prefix ).
      READ TABLE lt_parts INDEX 2 INTO ev_local.
    ENDIF.
    ncname( ev_local ).
    ls_lexical-raw = iv_name.
    ls_lexical-prefix = ev_prefix.
    ls_lexical-local = ev_local.
    INSERT ls_lexical INTO TABLE mt_lexical.
  ENDMETHOD.
  METHOD scan_name.
    DATA lv_begin TYPE i.
    DATA lv_next TYPE i.
    DATA lv_cp TYPE i.
    DATA lv_colon TYPE i VALUE -1.
    DATA lv_start TYPE abap_bool VALUE abap_true.
    DATA ls_lexical TYPE ty_lexical.
    lv_begin = mv_pos.
*   Validate QName components in the tokenizer's existing character walk.
    WHILE mv_pos < strlen( mv_text ).
      lv_next = mv_pos.
      lv_cp = codepoint( EXPORTING iv_text = mv_text CHANGING cv_pos = lv_next ).
      IF lv_cp = 58.
        IF lv_start = abap_true OR lv_colon >= 0.
          fail( ).
        ENDIF.
        lv_colon = mv_pos - lv_begin.
        lv_start = abap_true.
      ELSE.
        IF name_char( lv_cp ) = abap_false.
          EXIT.
        ENDIF.
        IF lv_start = abap_true AND name_start( lv_cp ) = abap_false.
          fail( ).
        ENDIF.
        lv_start = abap_false.
      ENDIF.
      mv_pos = lv_next.
    ENDWHILE.
    IF lv_start = abap_true.
      fail( ).
    ENDIF.
    rv_name = substring( val = mv_text off = lv_begin len = mv_pos - lv_begin ).
    ls_lexical-raw = rv_name.
    IF lv_colon >= 0.
      ls_lexical-prefix = rv_name(lv_colon).
      ls_lexical-local = substring( val = rv_name off = lv_colon + 1 ).
    ELSE.
      ls_lexical-local = rv_name.
    ENDIF.
    INSERT ls_lexical INTO TABLE mt_lexical.
  ENDMETHOD.
  METHOD valid_char.
    rv_ok = boolc( iv_cp = 9 OR iv_cp = 10 OR iv_cp = 13 OR ( iv_cp >= 32 AND iv_cp <= 55295 )
      OR ( iv_cp >= 57344 AND iv_cp <= 65533 ) OR ( iv_cp >= 65536 AND iv_cp <= 1114111 ) ).
  ENDMETHOD.
  METHOD decode.
    DATA lv_pos TYPE i.
    DATA lv_off TYPE i.
    DATA lv_tail TYPE string.
    DATA lv_entity TYPE string.
    DATA lv_cp TYPE i.
    DATA lv_base TYPE i.
    DATA lv_digit TYPE i.
    DATA lv_digits TYPE string VALUE `0123456789abcdef`.
    DATA lv_char TYPE string.
    DATA lv_high TYPE x LENGTH 2.
    DATA lv_low TYPE x LENGTH 2.
    DATA lv_bytes TYPE xstring.
    WHILE lv_pos < strlen( iv_raw ).
      lv_tail = substring( val = iv_raw off = lv_pos ).
      FIND FIRST OCCURRENCE OF `&` IN lv_tail MATCH OFFSET lv_off.
      IF sy-subrc <> 0.
        rv_text = rv_text && lv_tail.
        EXIT.
      ENDIF.
      rv_text = rv_text && lv_tail(lv_off).
      lv_pos = lv_pos + lv_off + 1.
      lv_tail = substring( val = iv_raw off = lv_pos ).
      FIND FIRST OCCURRENCE OF `;` IN lv_tail MATCH OFFSET lv_off.
      IF sy-subrc <> 0.
        fail( ).
      ENDIF.
      lv_entity = lv_tail(lv_off).
      lv_pos = lv_pos + lv_off + 1.
      CASE lv_entity.
        WHEN `amp`.
          rv_text = rv_text && `&`.
        WHEN `lt`.
          rv_text = rv_text && `<`.
        WHEN `gt`.
          rv_text = rv_text && `>`.
        WHEN `apos`.
          rv_text = rv_text && `'`.
        WHEN `quot`.
          rv_text = rv_text && `"`.
        WHEN OTHERS.
          IF lv_entity IS INITIAL OR lv_entity(1) <> `#`.
            fail( ).
          ENDIF.
          lv_entity = lv_entity+1.
          lv_base = 10.
          IF lv_entity IS NOT INITIAL AND lv_entity(1) = `x`.
            lv_base = 16.
            lv_entity = lv_entity+1.
          ENDIF.
          IF lv_entity IS INITIAL.
            fail( ).
          ENDIF.
          CLEAR lv_cp.
          DO strlen( lv_entity ) TIMES.
            lv_off = sy-index - 1.
            lv_char = to_lower( lv_entity+lv_off(1) ).
            FIND FIRST OCCURRENCE OF lv_char IN lv_digits MATCH OFFSET lv_digit.
            IF sy-subrc <> 0 OR lv_digit >= lv_base OR lv_cp > 1114111.
              fail( ).
            ENDIF.
            lv_cp = lv_cp * lv_base + lv_digit.
          ENDDO.
          IF valid_char( lv_cp ) = abap_false.
            fail( ).
          ENDIF.
          IF lv_cp <= 65535.
            lv_high = lv_cp.
            CONCATENATE lv_high+1(1) lv_high(1) INTO lv_bytes IN BYTE MODE.
            rv_text = rv_text && cl_abap_codepage=>convert_from( source = lv_bytes codepage = `4103` ).
          ELSE.
*           Convert the complete UTF-16 pair together. uccpi is BMP-only.
            lv_high = 55296 + ( lv_cp - 65536 ) DIV 1024.
            lv_low = 56320 + ( lv_cp - 65536 ) MOD 1024.
            CONCATENATE lv_high+1(1) lv_high(1) lv_low+1(1) lv_low(1) INTO lv_bytes IN BYTE MODE.
            rv_text = rv_text && cl_abap_codepage=>convert_from( source = lv_bytes codepage = `4103` ).
          ENDIF.
      ENDCASE.
    ENDWHILE.
  ENDMETHOD.
  METHOD expand.
    DATA lv_prefix TYPE string.
    DATA ls_binding TYPE ty_binding.
    split_name( EXPORTING iv_name = iv_raw IMPORTING ev_prefix = lv_prefix ev_local = rs_name-local ).
    IF lv_prefix = `xmlns`.
      fail( ).
    ENDIF.
    IF lv_prefix IS NOT INITIAL OR iv_attribute = abap_false.
      READ TABLE it_bindings INTO ls_binding WITH TABLE KEY prefix = lv_prefix.
      rs_name-uri = ls_binding-uri.
    ENDIF.
    IF lv_prefix IS NOT INITIAL AND rs_name-uri IS INITIAL.
      fail( ).
    ENDIF.
  ENDMETHOD.
  METHOD restore.
    DATA ls_undo TYPE ty_undo.
    DATA ls_binding TYPE ty_binding.
    FIELD-SYMBOLS <binding> TYPE ty_binding.
*   Each prefix occurs once per element (raw duplicates have been refused).
    LOOP AT it_undo INTO ls_undo.
      IF ls_undo-existed = abap_true.
        READ TABLE mt_bindings ASSIGNING <binding> WITH TABLE KEY prefix = ls_undo-prefix.
        <binding>-uri = ls_undo-uri.
      ELSE.
        ls_binding-prefix = ls_undo-prefix.
        DELETE TABLE mt_bindings FROM ls_binding.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD text.
    FIELD-SYMBOLS <frame> TYPE ty_frame.
    DATA lv_test TYPE string.
    FIELD-SYMBOLS <element> TYPE zif_osd_adt_xml=>ty_element.
    IF mt_stack IS INITIAL.
      lv_test = iv_value.
      REPLACE ALL OCCURRENCES OF REGEX `[ \t\r\n]` IN lv_test WITH ``.
      IF lv_test IS NOT INITIAL.
        fail( ).
      ENDIF.
      RETURN.
    ENDIF.
    READ TABLE mt_stack INDEX lines( mt_stack ) ASSIGNING <frame>.
    READ TABLE mt_elements INDEX <frame>-id ASSIGNING <element>.
    <element>-text = <element>-text && iv_value.
    mv_tokens = mv_tokens && zcl_osd_adt_xml=>esc( iv_value ).
  ENDMETHOD.
  METHOD run.
    DATA lv_bytes TYPE xstring.
    DATA lv_forbidden TYPE string.
    DATA lv_begin TYPE i.
    DATA lv_raw TYPE string.
    DATA lv_target TYPE string.
    DATA lv_value TYPE string.
    DATA lv_quote TYPE string.
    DATA lv_closing TYPE abap_bool.
    DATA lv_empty TYPE abap_bool.
    DATA lv_separated TYPE abap_bool.
    DATA lv_name TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_local TYPE string.
    DATA lv_required TYPE string.
    DATA lv_roots TYPE i.
    DATA lv_parent TYPE i.
    DATA lv_cname TYPE string.
    DATA lv_output TYPE string.
    DATA lv_attrname TYPE string.
    DATA lt_raw TYPE tt_raw.
    DATA ls_raw TYPE ty_raw.
    DATA lt_seen TYPE tt_seen.
    DATA lt_expanded TYPE tt_expanded.
    DATA ls_expanded TYPE ty_expanded.
    DATA lt_undo TYPE tt_undo.
    DATA ls_undo TYPE ty_undo.
    DATA ls_binding TYPE ty_binding.
    DATA ls_frame TYPE ty_frame.
    DATA ls_element TYPE zif_osd_adt_xml=>ty_element.
    DATA ls_attribute TYPE zif_osd_adt_xml=>ty_attribute.
    DATA lt_profiles TYPE string_table.
    DATA lv_profile TYPE string.
    DATA lv_admitted TYPE abap_bool.
    DATA lx_error TYPE REF TO cx_root.
    FIELD-SYMBOLS <binding> TYPE ty_binding.
    FIELD-SYMBOLS <frame> TYPE ty_frame.
    IF xstrlen( iv_body ) > c_body_limit.
      fail( ).
    ENDIF.
    TRY.
        mv_text = cl_abap_codepage=>convert_from( iv_body ).
        lv_bytes = cl_abap_codepage=>convert_to( mv_text ).
        IF lv_bytes <> iv_body.
          fail( ).
        ENDIF.
        IF xstrlen( iv_body ) >= 3 AND iv_body(3) = 'EFBBBF'.
          mv_text = mv_text+1.
        ENDIF.
        FIND REGEX `[\x00-\x08\x0B\x0C\x0E-\x1F]` IN mv_text.
        IF sy-subrc = 0.
          fail( ).
        ENDIF.
        lv_forbidden = cl_abap_conv_in_ce=>uccpi( 65534 ).
        IF mv_text CS lv_forbidden.
          fail( ).
        ENDIF.
        lv_forbidden = cl_abap_conv_in_ce=>uccpi( 65535 ).
        IF mv_text CS lv_forbidden.
          fail( ).
        ENDIF.
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN mv_text WITH cl_abap_char_utilities=>newline.
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf(1) IN mv_text WITH cl_abap_char_utilities=>newline.
        ls_binding-prefix = `xml`.
        ls_binding-uri = `http://www.w3.org/XML/1998/namespace`.
        INSERT ls_binding INTO TABLE mt_bindings.
        SPLIT iv_profile AT `,` INTO TABLE lt_profiles.
        WHILE mv_pos < strlen( mv_text ).
          IF starts( `<!--` ) = abap_true.
            mv_pos = mv_pos + 4.
            lv_raw = until( `--` ).
            expect( `>` ).
            CONTINUE.
          ENDIF.
          IF starts( `<?` ) = abap_true.
            lv_begin = mv_pos.
            mv_pos = mv_pos + 2.
            lv_target = scan_name( ).
            IF lv_target CS `:`.
              fail( ).
            ENDIF.
            IF to_lower( lv_target ) = `xml`.
              lv_value = until( `?>` ).
              lv_raw = lv_target && lv_value.
              FIND REGEX `^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.0\1([ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(['"])[Uu][Tt][Ff]-8\3)?([ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(['"])(yes|no)\5)?[ \t\r\n]*$` IN lv_raw.
              IF lv_begin <> 0 OR sy-subrc <> 0.
                fail( ).
              ENDIF.
            ELSE.
              IF starts( `?>` ) = abap_false AND space( ) = abap_false.
                fail( ).
              ENDIF.
              lv_raw = until( `?>` ).
            ENDIF.
            CONTINUE.
          ENDIF.
          IF starts( `<![CDATA[` ) = abap_true.
            IF mt_stack IS INITIAL.
              fail( ).
            ENDIF.
            mv_pos = mv_pos + 9.
            lv_value = until( `]]>` ).
            text( lv_value ).
            CONTINUE.
          ENDIF.
          IF starts( `<` ) = abap_false.
            lv_begin = mv_pos.
            lv_raw = substring( val = mv_text off = mv_pos ).
            FIND FIRST OCCURRENCE OF `<` IN lv_raw MATCH OFFSET lv_parent.
            IF sy-subrc <> 0.
              mv_pos = strlen( mv_text ).
            ELSE.
              mv_pos = mv_pos + lv_parent.
            ENDIF.
            lv_raw = substring( val = mv_text off = lv_begin len = mv_pos - lv_begin ).
            IF lv_raw CS `]]>` OR ( mt_stack IS INITIAL AND lv_raw CS `&` ).
              fail( ).
            ENDIF.
            lv_value = decode( lv_raw ).
            text( lv_value ).
            CONTINUE.
          ENDIF.
          IF starts( `<!` ) = abap_true.
            fail( ).
          ENDIF.
          lv_closing = starts( `</` ).
          mv_pos = mv_pos + 1.
          IF lv_closing = abap_true.
            mv_pos = mv_pos + 1.
          ENDIF.
          lv_name = scan_name( ).
          IF lv_closing = abap_true.
            space( ).
            expect( `>` ).
            READ TABLE mt_stack INDEX lines( mt_stack ) ASSIGNING <frame>.
            IF sy-subrc <> 0 OR <frame>-raw <> lv_name.
              fail( ).
            ENDIF.
            mv_tokens = mv_tokens && `</` && <frame>-canonical && `>`.
            restore( <frame>-undo ).
            DELETE mt_stack INDEX lines( mt_stack ).
            CONTINUE.
          ENDIF.
          CLEAR: lt_raw, lt_seen, lt_expanded, lt_undo, lv_empty.
          DO.
            lv_separated = space( ).
            IF starts( `>` ) = abap_true.
              mv_pos = mv_pos + 1.
              EXIT.
            ELSEIF starts( `/>` ) = abap_true.
              mv_pos = mv_pos + 2.
              lv_empty = abap_true.
              EXIT.
            ENDIF.
            IF lv_separated = abap_false.
              fail( ).
            ENDIF.
            ls_raw-name = scan_name( ).
            space( ).
            expect( `=` ).
            space( ).
            IF starts( `'` ) = abap_true.
              lv_quote = `'`.
            ELSEIF starts( `"` ) = abap_true.
              lv_quote = `"`.
            ELSE.
              fail( ).
            ENDIF.
            mv_pos = mv_pos + 1.
            lv_value = until( lv_quote ).
            IF lv_value CS `<`.
              fail( ).
            ENDIF.
            REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN lv_value WITH ` `.
            REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_value WITH ` `.
            ls_raw-value = decode( lv_value ).
            INSERT ls_raw-name INTO TABLE lt_seen.
            IF sy-subrc <> 0.
              fail( ).
            ENDIF.
            APPEND ls_raw TO lt_raw.
          ENDDO.
          IF lines( mt_stack ) >= c_depth_limit.
            fail( ).
          ENDIF.
          CLEAR lv_parent.
          READ TABLE mt_stack INDEX lines( mt_stack ) ASSIGNING <frame>.
          IF sy-subrc = 0.
            lv_parent = <frame>-id.
          ENDIF.
          LOOP AT lt_raw INTO ls_raw.
            split_name( EXPORTING iv_name = ls_raw-name IMPORTING ev_prefix = lv_prefix ev_local = lv_local ).
            IF ls_raw-name <> `xmlns` AND lv_prefix <> `xmlns`.
              CONTINUE.
            ENDIF.
            CLEAR ls_binding-prefix.
            IF lv_prefix = `xmlns`.
              ls_binding-prefix = lv_local.
            ENDIF.
            ls_binding-uri = ls_raw-value.
            IF ls_binding-prefix = `xmlns` OR ls_binding-uri = `http://www.w3.org/2000/xmlns/`
                OR ( ls_binding-prefix = `xml` AND ls_binding-uri <> `http://www.w3.org/XML/1998/namespace` )
                OR ( ls_binding-prefix <> `xml` AND ls_binding-uri = `http://www.w3.org/XML/1998/namespace` )
                OR ( ls_binding-prefix IS NOT INITIAL AND ls_binding-uri IS INITIAL ).
              fail( ).
            ENDIF.
            CLEAR ls_undo.
            ls_undo-prefix = ls_binding-prefix.
            READ TABLE mt_bindings ASSIGNING <binding> WITH TABLE KEY prefix = ls_binding-prefix.
            IF sy-subrc = 0.
              ls_undo-existed = abap_true.
              ls_undo-uri = <binding>-uri.
              <binding>-uri = ls_binding-uri.
            ELSE.
              INSERT ls_binding INTO TABLE mt_bindings.
            ENDIF.
            APPEND ls_undo TO lt_undo.
          ENDLOOP.
          CLEAR ls_element.
          ls_attribute = expand( iv_raw = lv_name it_bindings = mt_bindings ).
          ls_element-uri = ls_attribute-uri.
          ls_element-local = ls_attribute-local.
          ls_element-parent = lv_parent.
          lv_prefix = prefix( ls_element-uri ).
          lv_required = required( ls_element-local ).
          IF ( lv_required = `none` AND ls_element-uri IS NOT INITIAL )
              OR ( lv_required IS NOT INITIAL AND lv_required <> `none` AND lv_required <> lv_prefix ).
            fail( ).
          ENDIF.
          IF mt_stack IS INITIAL.
            lv_roots = lv_roots + 1.
            IF lv_roots > 1.
              fail( ).
            ENDIF.
            IF iv_profile IS NOT INITIAL AND iv_profile <> `optional`.
              CLEAR lv_admitted.
              LOOP AT lt_profiles INTO lv_profile.
                IF lv_profile = lv_prefix.
                  lv_admitted = abap_true.
                ENDIF.
              ENDLOOP.
              IF lv_admitted = abap_false.
                fail( ).
              ENDIF.
            ENDIF.
          ENDIF.
          lv_cname = name( iv_uri = ls_element-uri iv_name = ls_element-local ).
          lv_output = `<` && lv_cname.
          LOOP AT lt_raw INTO ls_raw.
            split_name( EXPORTING iv_name = ls_raw-name IMPORTING ev_prefix = lv_prefix ev_local = lv_local ).
            IF ls_raw-name = `xmlns` OR lv_prefix = `xmlns`.
              CONTINUE.
            ENDIF.
            ls_attribute = expand( iv_raw = ls_raw-name it_bindings = mt_bindings iv_attribute = abap_true ).
            ls_expanded-uri = ls_attribute-uri.
            ls_expanded-local = ls_attribute-local.
            INSERT ls_expanded INTO TABLE lt_expanded.
            IF sy-subrc <> 0.
              fail( ).
            ENDIF.
            ls_attribute-value = ls_raw-value.
            APPEND ls_attribute TO ls_element-attributes.
            lv_attrname = name( iv_uri = ls_attribute-uri iv_name = ls_attribute-local ).
            lv_output = lv_output && ` ` && lv_attrname && `="` && zcl_osd_adt_xml=>esc( ls_attribute-value ) && `"`.
          ENDLOOP.
          APPEND ls_element TO mt_elements.
          mv_tokens = mv_tokens && lv_output && `>`.
          IF lv_empty = abap_true.
            mv_tokens = mv_tokens && `</` && lv_cname && `>`.
            restore( lt_undo ).
          ELSE.
            ls_frame-id = lines( mt_elements ).
            ls_frame-raw = lv_name.
            ls_frame-canonical = lv_cname.
            ls_frame-undo = lt_undo.
            APPEND ls_frame TO mt_stack.
          ENDIF.
        ENDWHILE.
        IF lv_roots <> 1 OR mt_stack IS NOT INITIAL.
          fail( ).
        ENDIF.
        rt_elements = mt_elements.
      CATCH cx_root INTO lx_error.
        fail( ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
