CLASS zcl_gogen_t_staticwrite DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS change CHANGING cv TYPE i.
    CLASS-METHODS output EXPORTING ev TYPE i.
ENDCLASS.
CLASS zcl_gogen_t_staticwrite IMPLEMENTATION.
  METHOD change.
    cv = cv + 1.
  ENDMETHOD.
  METHOD output.
    ev = 19.
  ENDMETHOD.
  METHOD run.
    DATA lx TYPE x LENGTH 2 VALUE 'ABCD'.
    DATA le TYPE x LENGTH 1 VALUE 'EE'.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF zcl_gogen_t_staticstate=>gv_mem WITH lx IN BYTE MODE.
    rv = |{ zcl_gogen_t_staticstate=>gv_init }/{ zcl_gogen_t_staticstate=>gv_mem }/{ xstrlen( zcl_gogen_t_staticstate=>gv_mem ) }|.
    CONCATENATE zcl_gogen_t_staticstate=>gv_mem le INTO zcl_gogen_t_staticstate=>gv_mem IN BYTE MODE.
    lx = zcl_gogen_t_staticstate=>gv_mem+3(2).
    rv = rv && |/{ lx }|.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF zcl_gogen_t_staticstate=>gv_text WITH 'XY'.
    CONCATENATE zcl_gogen_t_staticstate=>gv_text '!' INTO zcl_gogen_t_staticstate=>gv_text.
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_text }|.
    zcl_gogen_t_staticstate=>gv_hex = '00000000'.
    zcl_gogen_t_staticstate=>gv_hex+1(2) = lx.
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_hex }|.
    MOVE 3 TO zcl_gogen_t_staticstate=>gv_i.
    ADD 2 TO zcl_gogen_t_staticstate=>gv_i.
    zcl_gogen_t_staticstate=>gv_i = zcl_gogen_t_staticstate=>gv_i + 1.
    change( CHANGING cv = zcl_gogen_t_staticstate=>gv_i ).
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_i }|.
    output( IMPORTING ev = zcl_gogen_t_staticstate=>gv_i ).
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_i }|.
    CLEAR zcl_gogen_t_staticstate=>gv_i.
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_i }|.
    zcl_gogen_t_staticstate=>gv_8 = 9000000000.
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_8 }|.
    APPEND 3 TO zcl_gogen_t_staticstate=>gt_rows.
    INSERT 2 INTO zcl_gogen_t_staticstate=>gt_rows INDEX 1.
    rv = rv && |/{ lines( zcl_gogen_t_staticstate=>gt_rows ) }|.
    zcl_gogen_t_staticstate=>own_write( ).
    rv = rv && |/{ zcl_gogen_t_staticstate=>gv_i }|.
  ENDMETHOD.
ENDCLASS.
