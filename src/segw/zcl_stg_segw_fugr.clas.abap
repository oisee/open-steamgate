CLASS zcl_stg_segw_fugr DEFINITION PUBLIC CREATE PUBLIC.
* Function module signatures for the generator, in ZSTG_FM_PARAM: what SEGW
* reads from the function library (FUNCTION_IMPORT_INTERFACE) and
* tools/segw-gen-mapping.mjs reads from an abapGit *.fugr.xml. import takes
* that XML (POST FunctionGroupSet with the file as Content): every
* <FUNCTIONS><item> becomes the module's parameters, one row each, in the
* order of the file (STG_SEQ); the module's rows are replaced. signature
* gives them back to the generator.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_param,
             name     TYPE string,
             kind     TYPE string,
             type     TYPE string,
             optional TYPE abap_bool,
           END OF ty_param.
    TYPES tt_param TYPE STANDARD TABLE OF ty_param WITH DEFAULT KEY.

    TYPES: BEGIN OF ty_result,
             modules TYPE i,
             rows    TYPE i,
           END OF ty_result.

    CLASS-METHODS import
      IMPORTING
        iv_content       TYPE string
      RETURNING
        VALUE(rs_result) TYPE ty_result
      RAISING
        /iwbep/cx_mgw_busi_exception.

* the parameters of a module, importing / exporting / changing / tables;
* empty when the module is not in the table
    CLASS-METHODS signature
      IMPORTING
        iv_funcname      TYPE string
      RETURNING
        VALUE(rt_params) TYPE tt_param.

  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             funcname  TYPE string,
             parameter TYPE string,
             kind      TYPE string,
             typ       TYPE string,
             optional  TYPE string,
             remote    TYPE string,
           END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.

    CLASS-METHODS parse
      IMPORTING
        iv_content     TYPE string
      RETURNING
        VALUE(rt_rows) TYPE tt_row
      RAISING
        /iwbep/cx_mgw_busi_exception.

* the text between <tag> and </tag> from an offset, or nothing
    CLASS-METHODS section
      IMPORTING
        iv_text        TYPE string
        iv_tag         TYPE string
        iv_from        TYPE i DEFAULT 0
      EXPORTING
        ev_found       TYPE abap_bool
        ev_start       TYPE i
        ev_end         TYPE i
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS source
      RETURNING
        VALUE(ro_source) TYPE REF TO zif_stg_cds_source.
ENDCLASS.

CLASS zcl_stg_segw_fugr IMPLEMENTATION.

  METHOD section.
    DATA lv_open  TYPE i.
    DATA lv_close TYPE i.
    DATA lv_len   TYPE i.

    CLEAR ev_found.
    lv_open = find( val = iv_text sub = |<{ iv_tag }>| off = iv_from ).
    IF lv_open < 0.
      RETURN.
    ENDIF.
    lv_len = strlen( iv_tag ) + 2.
    lv_close = find( val = iv_text sub = |</{ iv_tag }>| off = lv_open + lv_len ).
    IF lv_close < 0.
      RETURN.
    ENDIF.
    ev_found = abap_true.
    ev_start = lv_open + lv_len.
    ev_end   = lv_close + lv_len + 1.
    rv_text  = substring( val = iv_text off = ev_start len = lv_close - ev_start ).
  ENDMETHOD.

  METHOD parse.
* <FUNCTIONS><item>: FUNCNAME, REMOTE_CALL, then IMPORT/RSIMP, EXPORT/RSEXP,
* CHANGING/RSCHA, TABLES/RSTBL with PARAMETER and TYP (DBFIELD for LIKE,
* DBSTRUCT for a table parameter typed by a structure), OPTIONAL
    DATA lv_functions TYPE string.
    DATA lv_item      TYPE string.
    DATA lv_pos       TYPE i.
    DATA lv_found     TYPE abap_bool.
    DATA lv_start     TYPE i.
    DATA lv_end       TYPE i.
    DATA lv_block     TYPE string.
    DATA lv_param     TYPE string.
    DATA lv_at        TYPE i.
    DATA lv_kinds     TYPE string.
    DATA lv_i         TYPE i.
    DATA lv_section   TYPE string.
    DATA lv_tag       TYPE string.
    DATA ls_row       TYPE ty_row.
    DATA lv_remote    TYPE string.

    lv_functions = section( EXPORTING iv_text = iv_content iv_tag = 'FUNCTIONS' IMPORTING ev_found = lv_found ).
    IF lv_found = abap_false.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          message = 'no <FUNCTIONS> in the content: not an abapGit function group'.
    ENDIF.
    lv_pos = 0.
    DO.
      lv_item = section( EXPORTING iv_text = lv_functions iv_tag = 'item' iv_from = lv_pos
                         IMPORTING ev_found = lv_found ev_end = lv_end ).
      IF lv_found = abap_false.
        EXIT.
      ENDIF.
      lv_pos = lv_end.
      CLEAR ls_row.
      ls_row-funcname = section( iv_text = lv_item iv_tag = 'FUNCNAME' ).
      IF ls_row-funcname IS INITIAL.
        CONTINUE.
      ENDIF.
      lv_remote = section( iv_text = lv_item iv_tag = 'REMOTE_CALL' ).
      IF lv_remote = 'R'.
        ls_row-remote = 'X'.
      ENDIF.
      DO 4 TIMES.
        CASE sy-index.
          WHEN 1.
            lv_section = 'IMPORT'.
            lv_tag = 'RSIMP'.
            ls_row-kind = 'I'.
          WHEN 2.
            lv_section = 'EXPORT'.
            lv_tag = 'RSEXP'.
            ls_row-kind = 'E'.
          WHEN 3.
            lv_section = 'CHANGING'.
            lv_tag = 'RSCHA'.
            ls_row-kind = 'C'.
          WHEN 4.
            lv_section = 'TABLES'.
            lv_tag = 'RSTBL'.
            ls_row-kind = 'T'.
        ENDCASE.
        lv_block = section( EXPORTING iv_text = lv_item iv_tag = lv_section IMPORTING ev_found = lv_found ).
        IF lv_found = abap_false.
          CONTINUE.
        ENDIF.
        lv_at = 0.
        DO.
          lv_param = section( EXPORTING iv_text = lv_block iv_tag = lv_tag iv_from = lv_at
                              IMPORTING ev_found = lv_found ev_end = lv_end ).
          IF lv_found = abap_false.
            EXIT.
          ENDIF.
          lv_at = lv_end.
          ls_row-parameter = section( iv_text = lv_param iv_tag = 'PARAMETER' ).
          ls_row-typ = section( iv_text = lv_param iv_tag = 'TYP' ).
          IF ls_row-typ IS INITIAL.
            ls_row-typ = section( iv_text = lv_param iv_tag = 'DBFIELD' ).
          ENDIF.
          IF ls_row-typ IS INITIAL.
            ls_row-typ = section( iv_text = lv_param iv_tag = 'DBSTRUCT' ).
          ENDIF.
          ls_row-optional = section( iv_text = lv_param iv_tag = 'OPTIONAL' ).
          APPEND ls_row TO rt_rows.
        ENDDO.
      ENDDO.
    ENDDO.
  ENDMETHOD.

  METHOD source.
    DATA lv_class TYPE string.
    lv_class = 'ZCL_STG_TAB_ZSTG_FM_PARAM'.
    CREATE OBJECT ro_source TYPE (lv_class).
  ENDMETHOD.

  METHOD import.
    DATA lt_rows    TYPE tt_row.
    DATA ls_row     TYPE ty_row.
    DATA lo_source  TYPE REF TO zif_stg_cds_source.
    DATA lt_orderby TYPE string_table.
    DATA lr_data    TYPE REF TO data.
    DATA lr_line    TYPE REF TO data.
    DATA lv_last    TYPE string.
    DATA lv_seq     TYPE i.
    DATA lv_subrc   TYPE sy-subrc.
    FIELD-SYMBOLS <lt_data>  TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_old>   TYPE any.
    FIELD-SYMBOLS <ls_line>  TYPE any.
    FIELD-SYMBOLS <lv_value> TYPE any.

    lt_rows = parse( iv_content ).
    lo_source = source( ).
    LOOP AT lt_rows INTO ls_row.
      IF ls_row-funcname <> lv_last.
        lv_last = ls_row-funcname.
        lv_seq = 0.
        rs_result-modules = rs_result-modules + 1.
* the module's rows go, the new ones come in the order of the file
        lr_data = lo_source->read( iv_where   = |FUNCNAME = '{ replace( val = ls_row-funcname sub = `'` with = `''` occ = 0 ) }'|
                                   it_orderby = lt_orderby ).
        ASSIGN lr_data->* TO <lt_data>.
        LOOP AT <lt_data> ASSIGNING <ls_old>.
          lo_source->delete( <ls_old> ).
        ENDLOOP.
      ENDIF.
      lv_seq = lv_seq + 1.
      lr_line = lo_source->create_line( ).
      ASSIGN lr_line->* TO <ls_line>.
      ASSIGN COMPONENT 'MANDT' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = sy-mandt.
      ASSIGN COMPONENT 'FUNCNAME' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-funcname.
      ASSIGN COMPONENT 'PARAMETER' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-parameter.
      ASSIGN COMPONENT 'KIND' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-kind.
      ASSIGN COMPONENT 'TYP' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-typ.
      ASSIGN COMPONENT 'OPTIONAL' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-optional.
      ASSIGN COMPONENT 'REMOTE' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = ls_row-remote.
      ASSIGN COMPONENT 'STG_SEQ' OF STRUCTURE <ls_line> TO <lv_value>.
      <lv_value> = lv_seq.
      lv_subrc = lo_source->insert( <ls_line> ).
      IF lv_subrc <> 0.
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
          EXPORTING
            message = |{ ls_row-funcname }: parameter { ls_row-parameter } twice|.
      ENDIF.
      rs_result-rows = rs_result-rows + 1.
    ENDLOOP.
* a function group whose modules have no parameters is a function group
* too (the corpus has one); nothing to store, nothing to complain about
  ENDMETHOD.

  METHOD signature.
    DATA lo_source  TYPE REF TO zif_stg_cds_source.
    DATA lt_orderby TYPE string_table.
    DATA lr_data    TYPE REF TO data.
    DATA ls_param   TYPE ty_param.
    DATA lv_kind    TYPE string.
    FIELD-SYMBOLS <lt_data>  TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls_row>   TYPE any.
    FIELD-SYMBOLS <lv_value> TYPE any.

    lo_source = source( ).
    APPEND 'STG_SEQ ASCENDING' TO lt_orderby.
    lr_data = lo_source->read( iv_where   = |FUNCNAME = '{ replace( val = iv_funcname sub = `'` with = `''` occ = 0 ) }'|
                               it_orderby = lt_orderby ).
    ASSIGN lr_data->* TO <lt_data>.
    LOOP AT <lt_data> ASSIGNING <ls_row>.
      CLEAR ls_param.
      ASSIGN COMPONENT 'PARAMETER' OF STRUCTURE <ls_row> TO <lv_value>.
      ls_param-name = <lv_value>.
      ASSIGN COMPONENT 'KIND' OF STRUCTURE <ls_row> TO <lv_value>.
      lv_kind = <lv_value>.
      CASE lv_kind.
        WHEN 'I'.
          ls_param-kind = 'importing'.
        WHEN 'E'.
          ls_param-kind = 'exporting'.
        WHEN 'C'.
          ls_param-kind = 'changing'.
        WHEN 'T'.
          ls_param-kind = 'tables'.
      ENDCASE.
      ASSIGN COMPONENT 'TYP' OF STRUCTURE <ls_row> TO <lv_value>.
      ls_param-type = <lv_value>.
      ASSIGN COMPONENT 'OPTIONAL' OF STRUCTURE <ls_row> TO <lv_value>.
      ls_param-optional = xsdbool( <lv_value> = 'X' ).
      APPEND ls_param TO rt_params.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
