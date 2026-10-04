"! Shared ADT request XML reader. Only expanded names cross this boundary.
"! No DTD, no resolver, at most 64 elements deep and 16 MiB of input.
"! The canonical token stream adapts existing document extractors; its
"! spellings come from namespace URIs, never from request prefixes.
CLASS zcl_osd_adt_request_xml DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_body_limit TYPE i VALUE 16777216.
    CONSTANTS c_depth_limit TYPE i VALUE 64.
    CLASS-METHODS profile IMPORTING iv_method TYPE string iv_path TYPE string
      RETURNING VALUE(rv_profile) TYPE string.
    CLASS-METHODS read IMPORTING iv_body TYPE xstring iv_profile TYPE string OPTIONAL
      RETURNING VALUE(rv_tokens) TYPE string RAISING zcx_osd_adt.
    CLASS-METHODS prepare IMPORTING is_request TYPE zif_osd_adt_route=>ty_request
      RETURNING VALUE(rs_request) TYPE zif_osd_adt_route=>ty_request RAISING zcx_osd_adt.
  PRIVATE SECTION.
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
    DATA lv_tokens TYPE string.
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
    lv_tokens = read( iv_body = is_request-body iv_profile = lv_profile ).
    rs_request-body = cl_abap_codepage=>convert_to( lv_tokens ).
  ENDMETHOD.
  METHOD read.
    DATA lo_reader TYPE REF TO if_sxml_reader.
    DATA lv_text TYPE string.
    DATA lv_bytes TYPE xstring.
    DATA lv_bom TYPE x LENGTH 2 VALUE 'FFFE'.
    DATA lv_name TYPE string.
    DATA lv_prefix TYPE string.
    DATA lv_required TYPE string.
    DATA lv_depth TYPE i.
    DATA lv_roots TYPE i.
    DATA lv_wrapper_depth TYPE i.
    DATA lt_names TYPE string_table.
    DATA lt_profiles TYPE string_table.
    DATA lv_profile TYPE string.
    DATA lv_admitted TYPE abap_bool.
    DATA lv_kind TYPE i.
    DATA lt_attributes TYPE string_table.
    DATA lv_attribute TYPE string.
    DATA lv_value TYPE string.
    DATA lx_root TYPE REF TO cx_root.
    IF xstrlen( iv_body ) > c_body_limit.
      fail( ).
    ENDIF.
    TRY.
        lv_text = cl_abap_codepage=>convert_from( iv_body ).
        FIND REGEX `<!DOCTYPE` IN lv_text IGNORING CASE.
        IF sy-subrc = 0.
          fail( ).
        ENDIF.
*       Select the implemented character parser; see the sxml-byte-find
*       anomaly. The byte parser can find a quote between hex bytes.
        lv_bytes = cl_abap_codepage=>convert_to( lv_text ).
        IF lv_bytes <> iv_body.
          fail( ).
        ENDIF.
        IF xstrlen( iv_body ) >= 3 AND iv_body(3) = 'EFBBBF'.
          lv_text = lv_text+1.
        ENDIF.
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN lv_text WITH cl_abap_char_utilities=>newline.
        REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf(1) IN lv_text WITH cl_abap_char_utilities=>newline.
*       Never enter the reader's JSON fallback for a malformed XML body.
        FIND REGEX `^[ \t\n\r]*<` IN lv_text.
        IF sy-subrc <> 0.
          fail( ).
        ENDIF.
*       sXML skips text with no parent. A private wrapper makes it visible
*       so the request reader can reject it instead of serving a prefix.
        lv_text = `<osd_request>` && lv_text && `</osd_request>`.
        lv_bytes = cl_abap_codepage=>convert_to( source = lv_text codepage = `4103` ).
        CONCATENATE lv_bom lv_bytes INTO lv_bytes IN BYTE MODE.
        lo_reader = cl_sxml_string_reader=>create( lv_bytes ).
        SPLIT iv_profile AT `,` INTO TABLE lt_profiles.
        DO.
          lo_reader->next_node( ).
          lv_kind = lo_reader->node_type.
          IF lv_kind = if_sxml_node=>co_nt_final OR lv_kind = if_sxml_node=>co_nt_initial.
            EXIT.
          ENDIF.
          CASE lv_kind.
            WHEN if_sxml_node=>co_nt_element_open.
              lv_wrapper_depth = lv_wrapper_depth + 1.
              IF lv_wrapper_depth = 1.
                CONTINUE.
              ENDIF.
              lv_depth = lv_depth + 1.
              IF lv_depth > c_depth_limit.
                fail( ).
              ENDIF.
              lv_prefix = prefix( lo_reader->nsuri ).
              lv_required = required( lo_reader->name ).
              IF lv_required = `none`.
                IF lv_prefix IS NOT INITIAL.
                  fail( ).
                ENDIF.
              ELSEIF lv_required IS NOT INITIAL AND lv_required <> lv_prefix.
                fail( ).
              ENDIF.
              IF lv_depth = 1.
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
              lv_name = name( iv_uri = lo_reader->nsuri iv_name = lo_reader->name ).
              APPEND lv_name TO lt_names.
              CLEAR lt_attributes.
              rv_tokens = rv_tokens && `<` && lv_name.
              DO.
                lo_reader->next_attribute( ).
                IF lo_reader->node_type <> if_sxml_node=>co_nt_attribute.
                  EXIT.
                ENDIF.
                IF lo_reader->nsuri = `http://www.w3.org/2000/xmlns/`.
                  CONTINUE.
                ENDIF.
                lv_attribute = lo_reader->nsuri && `#` && lo_reader->name.
                READ TABLE lt_attributes TRANSPORTING NO FIELDS WITH KEY table_line = lv_attribute.
                IF sy-subrc = 0.
                  fail( ).
                ENDIF.
                APPEND lv_attribute TO lt_attributes.
                lv_name = name( iv_uri = lo_reader->nsuri iv_name = lo_reader->name ).
                rv_tokens = rv_tokens && ` ` && lv_name && `="` && zcl_osd_adt_xml=>esc( lo_reader->value ) && `"`.
              ENDDO.
              rv_tokens = rv_tokens && `>`.
            WHEN if_sxml_node=>co_nt_element_close.
              lv_wrapper_depth = lv_wrapper_depth - 1.
              IF lv_wrapper_depth = 0.
                CONTINUE.
              ENDIF.
              READ TABLE lt_names INDEX lv_depth INTO lv_name.
              IF sy-subrc <> 0.
                fail( ).
              ENDIF.
              rv_tokens = rv_tokens && `</` && lv_name && `>`.
              DELETE lt_names INDEX lv_depth.
              lv_depth = lv_depth - 1.
            WHEN if_sxml_node=>co_nt_value.
              lv_value = lo_reader->value.
              IF lv_depth = 0.
                fail( ).
              ELSE.
                rv_tokens = rv_tokens && zcl_osd_adt_xml=>esc( lv_value ).
              ENDIF.
            WHEN OTHERS.
              fail( ).
          ENDCASE.
        ENDDO.
        IF lv_roots <> 1 OR lv_depth <> 0 OR lv_wrapper_depth <> 0.
          fail( ).
        ENDIF.
      CATCH cx_root INTO lx_root.
        fail( ).
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
