CLASS zcl_gogen_t_genericbind DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES ty_tab TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    CLASS-METHODS probe CHANGING ct TYPE ANY TABLE.
ENDCLASS.

CLASS zcl_gogen_t_genericbind IMPLEMENTATION.
  METHOD probe.
    FIELD-SYMBOLS <row> TYPE any.
    READ TABLE ct INDEX 1 ASSIGNING <row>.
    DELETE ct INDEX 1.
    DATA out TYPE i.
    out = <row>.
  ENDMETHOD.
  METHOD run.
    DATA lt TYPE ty_tab.
    DATA v TYPE i.
    v = 1. APPEND v TO lt.
    v = 2. APPEND v TO lt.
    probe( CHANGING ct = lt ).
    rv = `no dump`.
  ENDMETHOD.
ENDCLASS.
