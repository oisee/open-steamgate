CLASS zcl_gogen_t_staticoracle DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS w_assign RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS w_int8 RETURNING VALUE(rv) TYPE int8.
    CLASS-METHODS w_replace RETURNING VALUE(rv) TYPE xstring.
    CLASS-METHODS w_concat RETURNING VALUE(rv) TYPE xstring.
    CLASS-METHODS r_offset RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS w_clear RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_t_staticoracle IMPLEMENTATION.
  METHOD w_assign.
    zcl_gogen_t_staticstate=>gv_i = 5.
    zcl_gogen_t_staticstate=>gv_i = zcl_gogen_t_staticstate=>gv_i + 1.
    rv = zcl_gogen_t_staticstate=>gv_i.
  ENDMETHOD.
  METHOD w_int8.
    zcl_gogen_t_staticstate=>gv_8 = 9000000000.
    rv = zcl_gogen_t_staticstate=>gv_8.
  ENDMETHOD.
  METHOD w_replace.
    DATA lv_x TYPE x LENGTH 2 VALUE 'ABCD'.
    zcl_gogen_t_staticstate=>gv_mem = '00000000'.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF zcl_gogen_t_staticstate=>gv_mem WITH lv_x IN BYTE MODE.
    rv = zcl_gogen_t_staticstate=>gv_mem.
  ENDMETHOD.
  METHOD w_concat.
    DATA lv_x TYPE x LENGTH 1 VALUE 'EE'.
    zcl_gogen_t_staticstate=>gv_mem = '11'.
    CONCATENATE zcl_gogen_t_staticstate=>gv_mem lv_x INTO zcl_gogen_t_staticstate=>gv_mem IN BYTE MODE.
    rv = zcl_gogen_t_staticstate=>gv_mem.
  ENDMETHOD.
  METHOD r_offset.
    DATA lv_x TYPE x LENGTH 1.
    zcl_gogen_t_staticstate=>gv_mem = '0102037F'.
    lv_x = zcl_gogen_t_staticstate=>gv_mem+3(1).
    rv = lv_x.
  ENDMETHOD.
  METHOD w_clear.
    zcl_gogen_t_staticstate=>gv_i = 3.
    CLEAR zcl_gogen_t_staticstate=>gv_i.
    rv = zcl_gogen_t_staticstate=>gv_i.
  ENDMETHOD.
ENDCLASS.
