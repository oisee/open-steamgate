CLASS zcl_gogen_t_subx DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_subx IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_entry,
             crc32 TYPE x LENGTH 4,
           END OF ty_entry.
    DATA ls_entry TYPE ty_entry.
    DATA lv_crc TYPE x LENGTH 4.
    ls_entry-crc32 = 'FFFFFFFF'.
    lv_crc = '01020304'.
    ls_entry-crc32(1) = lv_crc+3(1).
    IF ls_entry-crc32 = '04FFFFFF'.
      rv = `X`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
