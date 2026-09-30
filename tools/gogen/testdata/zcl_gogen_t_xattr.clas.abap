CLASS zcl_gogen_t_xattr DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_crc TYPE x LENGTH 4.
    DATA mv_crc TYPE ty_crc VALUE 'FFFFFFFF'.
    METHODS check RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_xattr IMPLEMENTATION.
  METHOD run.
    DATA(lo) = NEW zcl_gogen_t_xattr( ).
    rv = lo->check( ).
  ENDMETHOD.
  METHOD check.
    IF mv_crc = 'FFFFFFFF'.
      rv = `X`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
