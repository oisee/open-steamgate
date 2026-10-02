CLASS zcl_abapiti_factorial DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor.
    METHODS factorial IMPORTING p0 TYPE i RETURNING VALUE(rv) TYPE i.
  PRIVATE SECTION.
    DATA mv_mem TYPE xstring.
    DATA mv_mem_pages TYPE i.
    METHODS mem_ld_i32 IMPORTING iv_addr TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS mem_st_i32 IMPORTING iv_addr TYPE i iv_val TYPE i.
    METHODS mem_ld_i32_8u IMPORTING iv_addr TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS mem_ld_i32_8s IMPORTING iv_addr TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS mem_ld_i32_16u IMPORTING iv_addr TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS mem_st_i32_8 IMPORTING iv_addr TYPE i iv_val TYPE i.
    METHODS mem_st_i32_16 IMPORTING iv_addr TYPE i iv_val TYPE i.
    METHODS mem_grow IMPORTING iv_pages TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS i32_add IMPORTING iv_a TYPE i iv_b TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS i32_sub IMPORTING iv_a TYPE i iv_b TYPE i RETURNING VALUE(rv) TYPE i.
    METHODS i32_mul IMPORTING iv_a TYPE i iv_b TYPE i RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_abapiti_factorial IMPLEMENTATION.
  METHOD constructor.
  ENDMETHOD.
  METHOD mem_ld_i32.
    DATA lv_le TYPE x LENGTH 4.
    DATA lv_be TYPE x LENGTH 4.
    lv_le = mv_mem+iv_addr(4).
    lv_be+0(1) = lv_le+3(1).
    lv_be+1(1) = lv_le+2(1).
    lv_be+2(1) = lv_le+1(1).
    lv_be+3(1) = lv_le+0(1).
    rv = lv_be.
  ENDMETHOD.
  METHOD mem_st_i32.
    DATA lv_le TYPE x LENGTH 4.
    DATA lv_be TYPE x LENGTH 4.
    lv_be = iv_val.
    lv_le+0(1) = lv_be+3(1).
    lv_le+1(1) = lv_be+2(1).
    lv_le+2(1) = lv_be+1(1).
    lv_le+3(1) = lv_be+0(1).
    REPLACE SECTION OFFSET iv_addr LENGTH 4 OF mv_mem WITH lv_le IN BYTE MODE.
  ENDMETHOD.
  METHOD mem_ld_i32_8u.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = mv_mem+iv_addr(1).
    rv = lv_b.
  ENDMETHOD.
  METHOD mem_ld_i32_8s.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = mv_mem+iv_addr(1).
    rv = lv_b.
    IF rv > 127. rv = rv - 256. ENDIF.
  ENDMETHOD.
  METHOD mem_ld_i32_16u.
    DATA lv_le TYPE x LENGTH 2.
    DATA lv_be TYPE x LENGTH 2.
    lv_le = mv_mem+iv_addr(2).
    lv_be+0(1) = lv_le+1(1).
    lv_be+1(1) = lv_le+0(1).
    rv = lv_be.
  ENDMETHOD.
  METHOD mem_st_i32_8.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = iv_val.
    REPLACE SECTION OFFSET iv_addr LENGTH 1 OF mv_mem WITH lv_b IN BYTE MODE.
  ENDMETHOD.
  METHOD mem_st_i32_16.
    DATA lv_le TYPE x LENGTH 2.
    DATA lv_be TYPE x LENGTH 2.
    lv_be = iv_val.
    lv_le+0(1) = lv_be+1(1).
    lv_le+1(1) = lv_be+0(1).
    REPLACE SECTION OFFSET iv_addr LENGTH 2 OF mv_mem WITH lv_le IN BYTE MODE.
  ENDMETHOD.
  METHOD mem_grow.
    DATA lv_zeros TYPE xstring.
    DATA lv_chunk TYPE x LENGTH 256.
    rv = mv_mem_pages.
    DO iv_pages * 256 TIMES.
      CONCATENATE lv_zeros lv_chunk INTO lv_zeros IN BYTE MODE.
    ENDDO.
    CONCATENATE mv_mem lv_zeros INTO mv_mem IN BYTE MODE.
    mv_mem_pages = mv_mem_pages + iv_pages.
  ENDMETHOD.
  METHOD i32_add.
    DATA lv_p TYPE p LENGTH 16 DECIMALS 0.
    lv_p = iv_a.
    lv_p = lv_p + iv_b.
    lv_p = lv_p MOD 4294967296.
    IF lv_p >= 2147483648.
      lv_p = lv_p - 4294967296.
    ENDIF.
    rv = lv_p.
  ENDMETHOD.
  METHOD i32_sub.
    DATA lv_p TYPE p LENGTH 16 DECIMALS 0.
    lv_p = iv_a.
    lv_p = lv_p - iv_b.
    lv_p = lv_p MOD 4294967296.
    IF lv_p >= 2147483648.
      lv_p = lv_p - 4294967296.
    ENDIF.
    rv = lv_p.
  ENDMETHOD.
  METHOD i32_mul.
    DATA lv_p TYPE p LENGTH 16 DECIMALS 0.
    lv_p = iv_a.
    lv_p = lv_p * iv_b.
    lv_p = lv_p MOD 4294967296.
    IF lv_p >= 2147483648.
      lv_p = lv_p - 4294967296.
    ENDIF.
    rv = lv_p.
  ENDMETHOD.
  METHOD factorial.
    DATA:  s0 TYPE i, s1 TYPE i, s2 TYPE i, s3 TYPE i, s4 TYPE i, s5 TYPE i, s6 TYPE i, s7 TYPE i, lv_br TYPE i.
    s0 = p0. s1 = 1. IF s0 <= s1. s0 = 1. ELSE. s0 = 0. ENDIF. IF s0 <> 0.
      s0 = 1.
    ELSE.
      s0 = p0. s1 = p0. s2 = 1. s1 = i32_sub( iv_a = s1 iv_b = s2 ). s1 = factorial( p0 = s1 ). s0 = i32_mul( iv_a = s0 iv_b = s1 ).
    ENDIF. rv = s0.
  ENDMETHOD.
ENDCLASS.
