CLASS zcl_gogen_t_scalarbind DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.

CLASS zcl_gogen_t_scalarbind IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    FIELD-SYMBOLS <row> TYPE i.
    v = 1. APPEND v TO lt ASSIGNING <row>.
    DO 64 TIMES.
      v = sy-index + 1.
      APPEND v TO lt.
    ENDDO.
    <row> = 9.
    READ TABLE lt INDEX 1 INTO v.
    rv = |{ v }|.
  ENDMETHOD.
ENDCLASS.
