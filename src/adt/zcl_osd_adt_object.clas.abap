CLASS zcl_osd_adt_object DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_osd_adt_route.
    CLASS-METHODS class_document IMPORTING is_object TYPE zcl_osd_adt_host=>ty_object RETURNING VALUE(rv_body) TYPE string.
    CLASS-METHODS properties IMPORTING iv_type TYPE string is_object TYPE zcl_osd_adt_host=>ty_read RETURNING VALUE(rv_body) TYPE string.
    CLASS-METHODS report_source IMPORTING iv_source TYPE string RETURNING VALUE(rv_yes) TYPE abap_bool.
    CLASS-METHODS view_entity IMPORTING iv_source TYPE string RETURNING VALUE(rv_yes) TYPE abap_bool.
  PRIVATE SECTION.
    CLASS-METHODS class_include IMPORTING is_object TYPE zcl_osd_adt_host=>ty_object iv_include TYPE string iv_uri TYPE string
      RETURNING VALUE(rv_body) TYPE string.
    CLASS-METHODS word_char IMPORTING iv_char TYPE string RETURNING VALUE(rv_yes) TYPE abap_bool.
ENDCLASS.
CLASS zcl_osd_adt_object IMPLEMENTATION.
  METHOD zif_osd_adt_route~handle.
    DATA lv_type TYPE string.
    DATA lv_name TYPE string.
    DATA lv_body TYPE string.
    DATA lv_mime TYPE string.
    DATA ls_param TYPE zif_osd_adt_route=>ty_param.
    DATA ls_object TYPE zcl_osd_adt_host=>ty_object.
    DATA ls_read TYPE zcl_osd_adt_host=>ty_read.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lv_type = zcl_osd_adt_source=>source_type( is_request-pattern ).
    READ TABLE is_request-params WITH KEY name = `name` INTO ls_param.
    lv_name = ls_param-value.
    IF lv_type = `CLAS`.
      zcl_osd_adt_host=>require( `OBJECT` ).
      ls_object = zcl_osd_adt_host=>object( iv_type = lv_type iv_name = lv_name ).
      IF ls_object-found = abap_false.
        lx_error = zcx_osd_adt=>not_found( iv_message = |CLAS { lv_name } does not exist| iv_miss = zcx_osd_adt=>c_miss_object ).
        RAISE EXCEPTION lx_error.
      ENDIF.
      IF ls_object-changed_at IS INITIAL.
        ls_object-changed_at = `1970-01-01T00:00:00Z`.
      ENDIF.
      IF ls_object-version IS INITIAL.
        ls_object-version = `active`.
      ENDIF.
      IF ls_object-changed_by IS INITIAL.
        ls_object-changed_by = `OSD`.
      ENDIF.
      lv_body = class_document( ls_object ).
      lv_mime = `application/vnd.sap.adt.oo.classes.v4+xml`.
    ELSE.
      ls_read = zcl_osd_adt_source=>read( iv_type = lv_type iv_name = lv_name ).
      IF ls_read-changed_by IS INITIAL.
        ls_read-changed_by = `OSD`.
      ENDIF.
      lv_body = properties( iv_type = lv_type is_object = ls_read ).
      CASE lv_type.
        WHEN `PROG`.
          lv_mime = `application/vnd.sap.adt.programs.programs.v3+xml`.
        WHEN `INTF`.
          lv_mime = `application/vnd.sap.adt.oo.interfaces.v2+xml`.
        WHEN `DDLS`.
          lv_mime = `application/vnd.sap.adt.ddlSource+xml`.
      ENDCASE.
    ENDIF.
    rs_response = zcl_osd_adt_entity=>send( is_request = is_request iv_body = lv_body iv_type = lv_mime ).
  ENDMETHOD.
  METHOD class_document.
    DATA lv_includes TYPE string.
    DATA lv_include TYPE string.
    DATA lv_uri TYPE string.
    lv_includes = class_include( is_object = is_object iv_include = `main` iv_uri = `source/main` ).
    LOOP AT is_object-includes INTO lv_include.
      lv_uri = `includes/` && lv_include.
      lv_includes = lv_includes && cl_abap_char_utilities=>newline
        && class_include( is_object = is_object iv_include = lv_include iv_uri = lv_uri ).
    ENDLOOP.
    rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"\n|
      && |                 xmlns:abapoo="http://www.sap.com/adt/oo"\n|
      && |                 xmlns:abapsource="http://www.sap.com/adt/abapsource"\n|
      && |                 xmlns:adtcore="http://www.sap.com/adt/core"\n|
      && |                 class:final="false"\n|
      && |                 class:abstract="false"\n|
      && |                 class:visibility="public"\n|
      && |                 class:category="generalObjectType"\n|
      && |                 class:sharedMemoryEnabled="false"\n|
      && |                 abapoo:modeled="false"\n|
      && |                 abapsource:fixPointArithmetic="true"\n|
      && |                 abapsource:activeUnicodeCheck="true"\n|
      && |                 adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-name ) }"\n|
      && |                 adtcore:type="CLAS/OC"\n|
      && |                 adtcore:version="{ is_object-version }"\n|
      && |                 adtcore:language="EN"\n|
      && |                 adtcore:masterLanguage="EN"\n|
      && |                 adtcore:abapLanguageVersion="standard"\n|
      && |                 adtcore:responsible="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && |                 adtcore:createdAt="{ is_object-changed_at }"\n|
      && |                 adtcore:createdBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && |                 adtcore:changedAt="{ is_object-changed_at }"\n|
      && |                 adtcore:changedBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && |                 adtcore:descriptionTextLimit="60"\n|
      && |                 adtcore:description="">\n|
      && |  <atom:link href="objectstructure" rel="http://www.sap.com/adt/relations/objectstructure" type="application/vnd.sap.adt.objectstructure.v2+xml" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( is_object-package ) ) }" adtcore:type="DEVC/K" adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-package ) }"/>\n|
      && |  <abapsource:syntaxConfiguration>\n|
      && |    <abapsource:language>\n|
      && |      <abapsource:version>X</abapsource:version>\n|
      && |      <abapsource:description>Standard ABAP</abapsource:description>\n|
      && |      <atom:link href="/sap/bc/adt/abapsource/parsers/rnd/grammar" rel="http://www.sap.com/adt/relations/abapsource/parser" type="text/plain" title="Standard ABAP" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |    </abapsource:language>\n|
      && |  </abapsource:syntaxConfiguration>\n|
      && |{ lv_includes }\n|
      && |</class:abapClass>\n|.
  ENDMETHOD.
  METHOD class_include.
    rv_body = |  <class:include class:includeType="{ iv_include }" abapsource:sourceUri="{ iv_uri }" adtcore:name="" adtcore:type="CLAS/I" adtcore:changedAt="{ is_object-changed_at }" adtcore:version="{ is_object-version }" adtcore:createdAt="{ is_object-changed_at }" adtcore:changedBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:createdBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }">\n|
      && |    <atom:link href="includes/{ iv_include }/versions" rel="http://www.sap.com/adt/relations/versions" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |    <atom:link href="{ iv_uri }" rel="http://www.sap.com/adt/relations/source" type="text/plain" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |    <atom:link href="{ iv_uri }" rel="http://www.sap.com/adt/relations/source" type="text/html" xmlns:atom="http://www.w3.org/2005/Atom"/>\n|
      && |  </class:include>\n|.
*   Joining includes adds exactly one LF between them.
    rv_body = substring( val = rv_body len = strlen( rv_body ) - 1 ).
  ENDMETHOD.
  METHOD properties.
    DATA lv_properties TYPE string.
    CASE iv_type.
      WHEN `PROG`.
        lv_properties = `program:lockedByEditor="false"`.
        IF report_source( is_object-source ) = abap_true.
          lv_properties = lv_properties && ` program:programType="executableProgram"`.
        ENDIF.
        rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs"\n|
      && | xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource"\n|
      && |\n|
      && | xmlns:atom="http://www.w3.org/2005/Atom" { lv_properties }\n|
      && | adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-name ) }" adtcore:type="PROG/P"\n|
      && | adtcore:description="" adtcore:version="active"\n|
      && | adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="standard"\n|
      && | adtcore:createdAt="1970-01-01T00:00:00Z" adtcore:changedAt="1970-01-01T00:00:00Z"\n|
      && | adtcore:createdBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:changedBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:responsible="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && | abapsource:sourceUri="source/main" abapsource:fixPointArithmetic="true"\n|
      && | abapsource:activeUnicodeCheck="true">\n|
      && |  <atom:link href="source/main/versions" rel="http://www.sap.com/adt/relations/versions"/>\n|
      && |  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>\n|
      && |  <adtcore:packageRef adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-package ) }" adtcore:type="DEVC/K"\n|
      && |   adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( is_object-package ) ) }"/>\n|
      && |  <abapsource:syntaxConfiguration><abapsource:language>\n|
      && |    <abapsource:version>X</abapsource:version><abapsource:description>Standard ABAP</abapsource:description>\n|
      && |  </abapsource:language></abapsource:syntaxConfiguration>\n|
      && |</program:abapProgram>\n|.
      WHEN `INTF`.
        lv_properties = `abapoo:modeled="false"`.
        rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces"\n|
      && | xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource"\n|
      && | xmlns:abapoo="http://www.sap.com/adt/oo"\n|
      && | xmlns:atom="http://www.w3.org/2005/Atom" { lv_properties }\n|
      && | adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-name ) }" adtcore:type="INTF/OI"\n|
      && | adtcore:description="" adtcore:version="active"\n|
      && | adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="standard"\n|
      && | adtcore:createdAt="1970-01-01T00:00:00Z" adtcore:changedAt="1970-01-01T00:00:00Z"\n|
      && | adtcore:createdBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:changedBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:responsible="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && | abapsource:sourceUri="source/main" abapsource:fixPointArithmetic="true"\n|
      && | abapsource:activeUnicodeCheck="true">\n|
      && |  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>\n|
      && |  <adtcore:packageRef adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-package ) }" adtcore:type="DEVC/K"\n|
      && |   adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( is_object-package ) ) }"/>\n|
      && |  <abapsource:syntaxConfiguration><abapsource:language>\n|
      && |    <abapsource:version>X</abapsource:version><abapsource:description>Standard ABAP</abapsource:description>\n|
      && |  </abapsource:language></abapsource:syntaxConfiguration>\n|
      && |</intf:abapInterface>\n|.
      WHEN `DDLS`.
        lv_properties = `ddl:source_origin="0" ddl:source_origin_description="ABAP Development Tools"`.
        IF view_entity( is_object-source ) = abap_true.
          lv_properties = lv_properties && ` ddl:source_type="view entity" ddl:source_type_description="View Entity"`.
        ENDIF.
        rv_body = |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"\n|
      && | xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource"\n|
      && |\n|
      && | xmlns:atom="http://www.w3.org/2005/Atom" { lv_properties }\n|
      && | adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-name ) }" adtcore:type="DDLS/DF"\n|
      && | adtcore:description="" adtcore:version="active"\n|
      && | adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="standard"\n|
      && | adtcore:createdAt="1970-01-01T00:00:00Z" adtcore:changedAt="1970-01-01T00:00:00Z"\n|
      && | adtcore:createdBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:changedBy="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }" adtcore:responsible="{ zcl_osd_adt_xml=>esc( is_object-changed_by ) }"\n|
      && | abapsource:sourceUri="source/main" abapsource:fixPointArithmetic="false"\n|
      && | abapsource:activeUnicodeCheck="false">\n|
      && |  <atom:link href="versions" rel="http://www.sap.com/adt/relations/versions"/>\n|
      && |  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain"/>\n|
      && |  <adtcore:packageRef adtcore:name="{ zcl_osd_adt_xml=>esc( is_object-package ) }" adtcore:type="DEVC/K"\n|
      && |   adtcore:uri="/sap/bc/adt/packages/{ zcl_osd_adt_uri=>encode_component( to_lower( is_object-package ) ) }"/>\n|
      && |</ddl:ddlSource>\n|.
    ENDCASE.
  ENDMETHOD.
  METHOD word_char.
    rv_yes = boolc( iv_char IS NOT INITIAL AND iv_char CO `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_` ).
  ENDMETHOD.
  METHOD report_source.
    DATA lt_lines TYPE string_table.
    DATA lv_line TYPE string.
    SPLIT iv_source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.
    LOOP AT lt_lines INTO lv_line.
      lv_line = to_lower( zcl_osd_adt_js=>trim( lv_line ) ).
      IF strlen( lv_line ) >= 6 AND lv_line(6) = `report`.
        IF strlen( lv_line ) = 6 OR word_char( substring( val = lv_line off = 6 len = 1 ) ) = abap_false.
          rv_yes = abap_true.
          RETURN.
        ENDIF.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.
  METHOD view_entity.
    DATA lv_source TYPE string.
    DATA lv_off TYPE i.
    DATA lv_start TYPE i.
    DATA lv_word TYPE string.
    DATA lv_char TYPE string.
    DATA lv_state TYPE i.
*   Only whitespace may separate the words; punctuation resets the state.
    lv_source = to_lower( iv_source ).
    WHILE lv_off < strlen( lv_source ).
      lv_char = lv_source+lv_off(1).
      IF word_char( lv_char ) = abap_true.
        lv_start = lv_off.
        WHILE lv_off < strlen( lv_source ) AND word_char( substring( val = lv_source off = lv_off len = 1 ) ) = abap_true.
          lv_off = lv_off + 1.
        ENDWHILE.
        lv_word = substring( val = lv_source off = lv_start len = lv_off - lv_start ).
        CASE lv_word.
          WHEN `define`.
            lv_state = 1.
          WHEN `root`.
            IF lv_state = 1.
              lv_state = 2.
            ELSE.
              lv_state = 0.
            ENDIF.
          WHEN `view`.
            IF lv_state = 1 OR lv_state = 2.
              lv_state = 3.
            ELSE.
              lv_state = 0.
            ENDIF.
          WHEN `entity`.
            IF lv_state = 3.
              rv_yes = abap_true.
              RETURN.
            ENDIF.
            lv_state = 0.
          WHEN OTHERS.
            lv_state = 0.
        ENDCASE.
      ELSE.
        IF zcl_osd_adt_js=>trim( lv_char ) IS NOT INITIAL.
          lv_state = 0.
        ENDIF.
        lv_off = lv_off + 1.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.
ENDCLASS.
