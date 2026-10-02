* Source: abapiti, 0facf0e, green on A4H.
* Copies of the memory helpers that wasm/memhelpers.go generates, as static
* methods on an explicit memory, so the exact generated pattern can be
* tested on its own.
CLASS zcl_abapiti_repro_mem DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS ld_i32 IMPORTING iv_mem TYPE xstring iv_addr TYPE i
      RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS st_i32 IMPORTING iv_addr TYPE i iv_val TYPE i
      CHANGING cv_mem TYPE xstring.
    CLASS-METHODS ld_8u IMPORTING iv_mem TYPE xstring iv_addr TYPE i
      RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS ld_8s IMPORTING iv_mem TYPE xstring iv_addr TYPE i
      RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS ld_16u IMPORTING iv_mem TYPE xstring iv_addr TYPE i
      RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS st_8 IMPORTING iv_addr TYPE i iv_val TYPE i
      CHANGING cv_mem TYPE xstring.
    CLASS-METHODS st_16 IMPORTING iv_addr TYPE i iv_val TYPE i
      CHANGING cv_mem TYPE xstring.
ENDCLASS.

CLASS zcl_abapiti_repro_mem IMPLEMENTATION.

  METHOD ld_i32.
    DATA lv_le TYPE x LENGTH 4.
    DATA lv_be TYPE x LENGTH 4.
    lv_le = iv_mem+iv_addr(4).
    lv_be+0(1) = lv_le+3(1).
    lv_be+1(1) = lv_le+2(1).
    lv_be+2(1) = lv_le+1(1).
    lv_be+3(1) = lv_le+0(1).
    rv = lv_be.
  ENDMETHOD.

  METHOD st_i32.
    DATA lv_le TYPE x LENGTH 4.
    DATA lv_be TYPE x LENGTH 4.
    lv_be = iv_val.
    lv_le+0(1) = lv_be+3(1).
    lv_le+1(1) = lv_be+2(1).
    lv_le+2(1) = lv_be+1(1).
    lv_le+3(1) = lv_be+0(1).
    REPLACE SECTION OFFSET iv_addr LENGTH 4 OF cv_mem WITH lv_le IN BYTE MODE.
  ENDMETHOD.

  METHOD ld_8u.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = iv_mem+iv_addr(1).
    rv = lv_b.
  ENDMETHOD.

  METHOD ld_8s.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = iv_mem+iv_addr(1).
    rv = lv_b.
    IF rv > 127. rv = rv - 256. ENDIF.
  ENDMETHOD.

  METHOD ld_16u.
    DATA lv_le TYPE x LENGTH 2.
    DATA lv_be TYPE x LENGTH 2.
    lv_le = iv_mem+iv_addr(2).
    lv_be+0(1) = lv_le+1(1).
    lv_be+1(1) = lv_le+0(1).
    rv = lv_be.
  ENDMETHOD.

  METHOD st_8.
    DATA lv_b TYPE x LENGTH 1.
    lv_b = iv_val.
    REPLACE SECTION OFFSET iv_addr LENGTH 1 OF cv_mem WITH lv_b IN BYTE MODE.
  ENDMETHOD.

  METHOD st_16.
    DATA lv_le TYPE x LENGTH 2.
    DATA lv_be TYPE x LENGTH 2.
    lv_be = iv_val.
    lv_le+0(1) = lv_be+1(1).
    lv_le+1(1) = lv_be+0(1).
    REPLACE SECTION OFFSET iv_addr LENGTH 2 OF cv_mem WITH lv_le IN BYTE MODE.
  ENDMETHOD.

ENDCLASS.
