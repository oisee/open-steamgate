CLASS zcl_gogen_t_ownedbench DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS init IMPORTING VALUE(memory) TYPE xstring.
    METHODS w1 RETURNING VALUE(result) TYPE i.
    METHODS w2 RETURNING VALUE(result) TYPE i.
    METHODS w3 RETURNING VALUE(result) TYPE i.
  PRIVATE SECTION.
    DATA mv_mem TYPE xstring.
ENDCLASS.
CLASS zcl_gogen_t_ownedbench IMPLEMENTATION.
  METHOD init.
    mv_mem = memory.
  ENDMETHOD.
  METHOD w1.
    DATA b TYPE x LENGTH 1.
    DATA off TYPE i.
    DO 100000 TIMES.
      off = ( sy-index - 1 ) MOD 65536.
      b = mv_mem+off(1).
      result = b.
      b = result.
      REPLACE SECTION OFFSET off LENGTH 1 OF mv_mem WITH b IN BYTE MODE.
    ENDDO.
  ENDMETHOD.
  METHOD w2.
    DATA b TYPE x LENGTH 4.
    DATA off TYPE i.
    DO 25000 TIMES.
      off = ( sy-index - 1 ) MOD 16384 * 4.
      b = mv_mem+off(4).
      result = b.
      b = result.
      REPLACE SECTION OFFSET off LENGTH 4 OF mv_mem WITH b IN BYTE MODE.
    ENDDO.
  ENDMETHOD.
  METHOD w3.
    DATA b TYPE x LENGTH 8.
    DATA off TYPE i.
    DO 12500 TIMES.
      off = ( sy-index - 1 ) MOD 8192 * 8.
      b = mv_mem+off(8).
      result = b.
      b = result.
      REPLACE SECTION OFFSET off LENGTH 8 OF mv_mem WITH b IN BYTE MODE.
    ENDDO.
  ENDMETHOD.
ENDCLASS.
