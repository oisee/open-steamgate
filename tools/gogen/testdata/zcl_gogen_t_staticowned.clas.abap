CLASS zcl_gogen_t_staticowned DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS class_constructor.
    CLASS-METHODS run RETURNING VALUE(r) TYPE string.
    METHODS instance_read RETURNING VALUE(r) TYPE xstring.
  PRIVATE SECTION.
    CLASS-DATA mv_mem TYPE xstring.
ENDCLASS.
CLASS zcl_gogen_t_staticowned IMPLEMENTATION.
  METHOD class_constructor.
    zcl_gogen_t_staticowned=>mv_mem = '01020304'.
  ENDMETHOD.
  METHOD instance_read.
    DATA part TYPE x LENGTH 2.
    part = zcl_gogen_t_staticowned=>mv_mem+1(2).
    r = part.
  ENDMETHOD.
  METHOD run.
    DATA replacement TYPE x LENGTH 2 VALUE 'ABCD'.
    DATA saved TYPE xstring.
    DATA bytes TYPE xstring.
    DATA part TYPE xstring.
    DATA lo TYPE REF TO zcl_gogen_t_staticowned.
    saved = zcl_gogen_t_staticowned=>mv_mem.
    REPLACE SECTION OFFSET 1 LENGTH 2 OF zcl_gogen_t_staticowned=>mv_mem WITH replacement IN BYTE MODE.
    CONCATENATE zcl_gogen_t_staticowned=>mv_mem zcl_gogen_t_staticowned=>mv_mem INTO zcl_gogen_t_staticowned=>mv_mem IN BYTE MODE.
    CREATE OBJECT lo.
    part = lo->instance_read( ).
    CONCATENATE saved zcl_gogen_t_staticowned=>mv_mem part INTO bytes IN BYTE MODE.
    r = bytes.
  ENDMETHOD.
ENDCLASS.
