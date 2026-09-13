CLASS zcl_stg_segw_import DEFINITION PUBLIC CREATE PUBLIC.
* An abapGit <project>.iwpr.xml into the ZSTG_SB* tables: what
* tools/segw-tree.mjs import does, inside the service (POST ImportSet).
* The file is read as abapGit writes it, <T><T>row</T>...</T> with the
* fields of a row as elements; a table block is ZSTG_<T>, a field element
* is a column, STG_SEQ is the row's position. The project's rows in every
* table are replaced. Nothing is written before every row has been checked
* against its table.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_result,
             project TYPE string,
             rows    TYPE i,
             tables  TYPE i,
           END OF ty_result.

    CLASS-METHODS import
      IMPORTING
        iv_content       TYPE string
      RETURNING
        VALUE(rs_result) TYPE ty_result
      RAISING
        /iwbep/cx_mgw_busi_exception.

* the project's rows out of every ZSTG_SB* table
    CLASS-METHODS clear_project
      IMPORTING
        iv_project     TYPE string
      RETURNING
        VALUE(rv_rows) TYPE i
      RAISING
        /iwbep/cx_mgw_busi_exception.

    CLASS-METHODS unescape
      IMPORTING
        iv_text        TYPE string
      RETURNING
        VALUE(rv_text) TYPE string.

  PRIVATE SECTION.
    TYPES: BEGIN OF ty_field,
             name  TYPE string,
             value TYPE string,
           END OF ty_field.
    TYPES tt_field TYPE STANDARD TABLE OF ty_field WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_row,
             tag    TYPE string,
             fields TYPE tt_field,
           END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_source,
             tag    TYPE string,
             source TYPE REF TO zif_stg_cds_source,
           END OF ty_source.
    TYPES tt_source TYPE STANDARD TABLE OF ty_source WITH DEFAULT KEY.

    CONSTANTS gc_prefix TYPE string VALUE '_-IWBEP_-I_'.
    CONSTANTS gc_class  TYPE string VALUE 'ZCL_STG_TAB_ZSTG_'.

    CLASS-METHODS parse
      IMPORTING
        iv_content     TYPE string
      RETURNING
        VALUE(rt_rows) TYPE tt_row
      RAISING
        /iwbep/cx_mgw_busi_exception.

    CLASS-METHODS source_of
      IMPORTING
        iv_tag           TYPE string
      CHANGING
        ct_sources       TYPE tt_source
      RETURNING
        VALUE(ro_source) TYPE REF TO zif_stg_cds_source
      RAISING
        /iwbep/cx_mgw_busi_exception.

    CLASS-METHODS fail
      IMPORTING
        iv_message TYPE string
      RAISING
        /iwbep/cx_mgw_busi_exception.
ENDCLASS.

CLASS zcl_stg_segw_import IMPLEMENTATION.

  METHOD import.
    DATA lt_rows    TYPE tt_row.
    DATA ls_row     TYPE ty_row.
    DATA ls_field   TYPE ty_field.
    DATA lt_sources TYPE tt_source.
    DATA lo_source  TYPE REF TO zif_stg_cds_source.
    DATA lt_lines   TYPE STANDARD TABLE OF REF TO data.
    DATA lr_line    TYPE REF TO data.
    DATA lv_tag     TYPE string.
    DATA lv_seq     TYPE i.
    DATA lv_index   TYPE i.
    DATA lv_text    TYPE string.
    DATA lv_back    TYPE string.
    DATA lv_subrc   TYPE sy-subrc.
    FIELD-SYMBOLS <ls_line> TYPE any.
    FIELD-SYMBOLS <lv_value> TYPE any.

    lt_rows = parse( iv_content ).
    IF lt_rows IS INITIAL.
      fail( 'no SEGW project tree in the content' ).
    ENDIF.

* every row into a line of its table, checked, nothing written yet
    LOOP AT lt_rows INTO ls_row.
      IF ls_row-tag <> lv_tag.
        lv_tag = ls_row-tag.
        lv_seq = 0.
        lo_source = source_of( EXPORTING iv_tag     = lv_tag
                               CHANGING  ct_sources = lt_sources ).
      ENDIF.
      lv_seq = lv_seq + 1.
      lr_line = lo_source->create_line( ).
      ASSIGN lr_line->* TO <ls_line>.
      ASSIGN COMPONENT 'MANDT' OF STRUCTURE <ls_line> TO <lv_value>.
      IF sy-subrc = 0.
        <lv_value> = sy-mandt.
      ENDIF.
      ASSIGN COMPONENT 'STG_SEQ' OF STRUCTURE <ls_line> TO <lv_value>.
      IF sy-subrc = 0.
        <lv_value> = lv_seq.
      ENDIF.
      LOOP AT ls_row-fields INTO ls_field.
        ASSIGN COMPONENT ls_field-name OF STRUCTURE <ls_line> TO <lv_value>.
        IF sy-subrc <> 0.
          fail( |{ ls_row-tag }.{ ls_field-name }: not a field of ZSTG_{ ls_row-tag }| ).
        ENDIF.
        lv_text = unescape( ls_field-value ).
        <lv_value> = lv_text.
        lv_back = <lv_value>.
        IF lv_back <> lv_text.
* a CHAR column cuts silently; the file would come back changed
          fail( |{ ls_row-tag }.{ ls_field-name }: the value does not fit the column of ZSTG_{ ls_row-tag } ({ strlen( lv_text ) } characters)| ).
        ENDIF.
        IF ls_field-name = 'PROJECT'.
          IF rs_result-project IS INITIAL.
            rs_result-project = <lv_value>.
          ELSEIF rs_result-project <> <lv_value>.
            fail( |rows of more than one project: { rs_result-project }, { <lv_value> }| ).
          ENDIF.
        ENDIF.
      ENDLOOP.
      APPEND lr_line TO lt_lines.
    ENDLOOP.
    IF rs_result-project IS INITIAL.
      fail( 'no PROJECT in the rows' ).
    ENDIF.

    clear_project( rs_result-project ).

    lv_tag = ''.
    LOOP AT lt_rows INTO ls_row.
      IF ls_row-tag <> lv_tag.
        lv_tag = ls_row-tag.
        rs_result-tables = rs_result-tables + 1.
        lo_source = source_of( EXPORTING iv_tag     = lv_tag
                               CHANGING  ct_sources = lt_sources ).
      ENDIF.
      lv_index = lv_index + 1.
      READ TABLE lt_lines INDEX lv_index INTO lr_line.
      ASSIGN lr_line->* TO <ls_line>.
      lv_subrc = lo_source->insert( <ls_line> ).
      IF lv_subrc <> 0.
        fail( |{ ls_row-tag }: a row with the same key twice| ).
      ENDIF.
      rs_result-rows = rs_result-rows + 1.
    ENDLOOP.
  ENDMETHOD.

  METHOD clear_project.
    DATA lt_entities TYPE zcl_stg_cds_registry=>tt_entity.
    DATA ls_entity   TYPE zcl_stg_cds_registry=>ty_entity.
    DATA lt_sources  TYPE tt_source.
    DATA lo_source   TYPE REF TO zif_stg_cds_source.
    DATA lt_orderby  TYPE string_table.
    DATA lr_data     TYPE REF TO data.
    DATA lv_where    TYPE string.
    DATA lv_tag      TYPE string.
    DATA lv_len      TYPE i.
    FIELD-SYMBOLS <lt_data> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>  TYPE any.

    lv_len = strlen( gc_class ).
    lv_where = |PROJECT = '{ replace( val = iv_project sub = `'` with = `''` occ = 0 ) }'|.
    lt_entities = zcl_stg_cds_registry=>entities( ).
    LOOP AT lt_entities INTO ls_entity.
      IF strlen( ls_entity-source_class ) <= lv_len OR ls_entity-source_class(lv_len) <> gc_class.
        CONTINUE.
      ENDIF.
      lv_tag = ls_entity-source_class+lv_len.
      IF lv_tag(3) <> 'SBD' AND lv_tag(3) <> 'SBO'.
        CONTINUE.
      ENDIF.
      lo_source = source_of( EXPORTING iv_tag     = lv_tag
                             CHANGING  ct_sources = lt_sources ).
      lr_data = lo_source->read( iv_where   = lv_where
                                 it_orderby = lt_orderby ).
      ASSIGN lr_data->* TO <lt_data>.
      LOOP AT <lt_data> ASSIGNING <ls_row>.
        lo_source->delete( <ls_row> ).
        rv_rows = rv_rows + 1.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD parse.
* <T><T>row</T></T> nesting: the first level under <asx:values> is a
* table, the second a row, an element inside a row is a field; the file
* is the only thing that knows the depth, so count it
    DATA lv_pos    TYPE i.
    DATA lv_off    TYPE i.
    DATA lv_end    TYPE i.
    DATA lv_close  TYPE i.
    DATA lv_len    TYPE i.
    DATA lv_name   TYPE string.
    DATA lv_depth  TYPE i.
    DATA lv_prefix TYPE i.
    DATA ls_row    TYPE ty_row.
    DATA ls_field  TYPE ty_field.
    DATA lv_open   TYPE abap_bool.

    lv_prefix = strlen( gc_prefix ).
    lv_len = strlen( iv_content ).
    DO.
      lv_off = find( val = iv_content sub = '<' off = lv_pos ).
      IF lv_off < 0.
        EXIT.
      ENDIF.
      lv_end = find( val = iv_content sub = '>' off = lv_off ).
      IF lv_end < 0.
        fail( 'unterminated tag' ).
      ENDIF.
      lv_name = substring( val = iv_content off = lv_off + 1 len = lv_end - lv_off - 1 ).
      lv_pos = lv_end + 1.
      IF lv_name IS INITIAL OR lv_name(1) = '?' OR lv_name(1) = '!'.
        CONTINUE.
      ENDIF.
      IF lv_name(1) = '/'.
        lv_name = lv_name+1.
        IF strlen( lv_name ) > lv_prefix AND lv_name(lv_prefix) = gc_prefix.
          IF lv_depth = 2 AND lv_open = abap_true.
            APPEND ls_row TO rt_rows.
            lv_open = abap_false.
          ENDIF.
          lv_depth = lv_depth - 1.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF strlen( lv_name ) > lv_prefix AND lv_name(lv_prefix) = gc_prefix.
        lv_depth = lv_depth + 1.
        IF lv_depth = 2.
          CLEAR ls_row.
          ls_row-tag = lv_name+lv_prefix.
          lv_open = abap_true.
        ENDIF.
        CONTINUE.
      ENDIF.
      IF lv_depth = 2 AND lv_open = abap_true.
* a field: its text runs to the matching closing tag; values are escaped, so
* no '<' inside
        lv_close = find( val = iv_content sub = |</{ lv_name }>| off = lv_pos ).
        IF lv_close < 0.
          fail( |{ ls_row-tag }.{ lv_name }: no closing tag| ).
        ENDIF.
        ls_field-name  = lv_name.
        ls_field-value = substring( val = iv_content off = lv_pos len = lv_close - lv_pos ).
        APPEND ls_field TO ls_row-fields.
        lv_pos = lv_close + strlen( lv_name ) + 3.
      ENDIF.
    ENDDO.
  ENDMETHOD.

  METHOD source_of.
    DATA ls_source TYPE ty_source.
    DATA lv_class  TYPE string.

    READ TABLE ct_sources INTO ls_source WITH KEY tag = iv_tag.
    IF sy-subrc = 0.
      ro_source = ls_source-source.
      RETURN.
    ENDIF.
    lv_class = gc_class && iv_tag.
    TRY.
        CREATE OBJECT ro_source TYPE (lv_class).
      CATCH cx_sy_create_object_error.
        fail( |{ iv_tag }: no table ZSTG_{ iv_tag } for it (tools/segw-tables.mjs)| ).
    ENDTRY.
    ls_source-tag    = iv_tag.
    ls_source-source = ro_source.
    APPEND ls_source TO ct_sources.
  ENDMETHOD.

  METHOD unescape.
    rv_text = iv_text.
    REPLACE ALL OCCURRENCES OF '&lt;' IN rv_text WITH '<'.
    REPLACE ALL OCCURRENCES OF '&gt;' IN rv_text WITH '>'.
    REPLACE ALL OCCURRENCES OF '&quot;' IN rv_text WITH '"'.
    REPLACE ALL OCCURRENCES OF '&apos;' IN rv_text WITH `'`.
    REPLACE ALL OCCURRENCES OF '&amp;' IN rv_text WITH '&'.
  ENDMETHOD.

  METHOD fail.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        message = iv_message.
  ENDMETHOD.

ENDCLASS.
