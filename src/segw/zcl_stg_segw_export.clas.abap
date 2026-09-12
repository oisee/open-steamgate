CLASS zcl_stg_segw_export DEFINITION PUBLIC CREATE PUBLIC.
* The ZSTG_SB* rows of a project back into an abapGit <project>.iwpr.xml,
* the mirror of zcl_stg_segw_import and of tools/segw-tree.mjs export:
* tables in alphabetical order (the order abapGit writes them), rows by
* STG_SEQ, fields in the table's order (the spec's, SEGW's), initial
* fields left out, escaped as abapGit escapes. Byte for byte what the
* import took in.
  PUBLIC SECTION.
    CLASS-METHODS export
      IMPORTING
        iv_project     TYPE string
      RETURNING
        VALUE(rv_xml)  TYPE string
      RAISING
        /iwbep/cx_mgw_busi_exception.

    CLASS-METHODS escape
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    CONSTANTS gc_class TYPE string VALUE 'ZCL_STG_TAB_ZSTG_'.

    CLASS-METHODS tags
      RETURNING
        VALUE(rt_tags) TYPE string_table.

    CLASS-METHODS rows_of
      IMPORTING
        iv_tag         TYPE string
        iv_project     TYPE string
      RETURNING
        VALUE(rv_xml)  TYPE string
      RAISING
        /iwbep/cx_mgw_busi_exception.
ENDCLASS.

CLASS zcl_stg_segw_export IMPLEMENTATION.

  METHOD export.
    DATA lt_tags TYPE string_table.
    DATA lv_tag  TYPE string.
    DATA lv_nl   TYPE string.
    DATA lv_body TYPE string.

    lv_nl = cl_abap_char_utilities=>newline.
    lt_tags = tags( ).
    LOOP AT lt_tags INTO lv_tag.
      lv_body = lv_body && rows_of( iv_tag     = lv_tag
                                    iv_project = iv_project ).
    ENDLOOP.
    IF lv_body IS INITIAL.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = |no project { iv_project }|.
    ENDIF.
    rv_xml = `<?xml version="1.0" encoding="utf-8"?>` && lv_nl
      && `<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWPR" serializer_version="v1.0.0">` && lv_nl
      && ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">` && lv_nl
      && `  <asx:values>` && lv_nl
      && lv_body
      && `  </asx:values>` && lv_nl
      && ` </asx:abap>` && lv_nl
      && `</abapGit>` && lv_nl.
  ENDMETHOD.

  METHOD tags.
* every ZSTG_SB* table the CDS registry knows a source for, alphabetical
    DATA lt_entities TYPE zcl_stg_cds_registry=>tt_entity.
    DATA ls_entity   TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lv_tag      TYPE string.
    DATA lv_len      TYPE i.

    lv_len = strlen( gc_class ).
    lt_entities = zcl_stg_cds_registry=>entities( ).
    LOOP AT lt_entities INTO ls_entity.
      IF strlen( ls_entity-source_class ) <= lv_len OR ls_entity-source_class(lv_len) <> gc_class.
        CONTINUE.
      ENDIF.
      lv_tag = ls_entity-source_class+lv_len.
      IF lv_tag(3) <> 'SBD' AND lv_tag(3) <> 'SBO'.
        CONTINUE.
      ENDIF.
      APPEND lv_tag TO rt_tags.
    ENDLOOP.
    SORT rt_tags.
  ENDMETHOD.

  METHOD rows_of.
    DATA lo_source     TYPE REF TO zif_stg_cds_source.
    DATA lv_class      TYPE string.
    DATA lt_orderby    TYPE string_table.
    DATA lr_data       TYPE REF TO data.
    DATA lo_struct     TYPE REF TO cl_abap_structdescr.
    DATA lt_components TYPE abap_component_tab.
    DATA ls_component  TYPE abap_componentdescr.
    DATA lv_nl         TYPE string.
    DATA lv_value      TYPE string.
    FIELD-SYMBOLS <lt_data>  TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>   TYPE any.
    FIELD-SYMBOLS <lv_field> TYPE any.

    lv_nl = cl_abap_char_utilities=>newline.
    lv_class = gc_class && iv_tag.
    CREATE OBJECT lo_source TYPE (lv_class).
    APPEND 'STG_SEQ ASCENDING' TO lt_orderby.
    lr_data = lo_source->read( iv_where   = |PROJECT = '{ replace( val = iv_project sub = `'` with = `''` occ = 0 ) }'|
                               it_orderby = lt_orderby ).
    ASSIGN lr_data->* TO <lt_data>.
    IF lines( <lt_data> ) = 0.
      RETURN.
    ENDIF.

    rv_xml = |   <_-IWBEP_-I_{ iv_tag }>{ lv_nl }|.
    LOOP AT <lt_data> ASSIGNING <ls_row>.
      IF lo_struct IS INITIAL.
        lo_struct ?= cl_abap_typedescr=>describe_by_data( <ls_row> ).
        lt_components = lo_struct->get_components( ).
      ENDIF.
      rv_xml = rv_xml && |    <_-IWBEP_-I_{ iv_tag }>{ lv_nl }|.
      LOOP AT lt_components INTO ls_component.
        IF ls_component-name = 'MANDT' OR ls_component-name = 'STG_SEQ'.
          CONTINUE.
        ENDIF.
        ASSIGN COMPONENT ls_component-name OF STRUCTURE <ls_row> TO <lv_field>.
        lv_value = <lv_field>.
        IF lv_value IS INITIAL.
          CONTINUE.
        ENDIF.
        rv_xml = rv_xml && |     <{ ls_component-name }>{ escape( lv_value ) }</{ ls_component-name }>{ lv_nl }|.
      ENDLOOP.
      rv_xml = rv_xml && |    </_-IWBEP_-I_{ iv_tag }>{ lv_nl }|.
    ENDLOOP.
    rv_xml = rv_xml && |   </_-IWBEP_-I_{ iv_tag }>{ lv_nl }|.
  ENDMETHOD.

  METHOD escape.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF '&' IN rv_text WITH '&amp;'.
    REPLACE ALL OCCURRENCES OF '<' IN rv_text WITH '&lt;'.
    REPLACE ALL OCCURRENCES OF '>' IN rv_text WITH '&gt;'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_text WITH '&quot;'.
    REPLACE ALL OCCURRENCES OF `'` IN rv_text WITH '&apos;'.
  ENDMETHOD.

ENDCLASS.
