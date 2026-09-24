* UNASSIGN <fs>: a generic and a typed field symbol are not assigned any
* more; the variable they pointed at keeps its value (ABAP keyword
* documentation, UNASSIGN; not an A4H measurement)
CLASS zcl_gogen_t_unassign DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_unassign IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_s,
             n TYPE i,
           END OF ty_s.
    DATA lv TYPE i VALUE 7.
    DATA lt TYPE STANDARD TABLE OF ty_s WITH DEFAULT KEY.
    DATA ls TYPE ty_s.
    FIELD-SYMBOLS <lg> TYPE any.
    FIELD-SYMBOLS <li> TYPE ty_s.
    ls-n = 5.
    APPEND ls TO lt.
    ASSIGN lv TO <lg>.
    READ TABLE lt INDEX 1 ASSIGNING <li>.
    rv = |{ boolc( <lg> IS ASSIGNED ) }{ boolc( <li> IS ASSIGNED ) }|.
    UNASSIGN <lg>.
    UNASSIGN <li>.
    rv = |{ rv }/{ boolc( <lg> IS ASSIGNED ) }{ boolc( <li> IS ASSIGNED ) }/{ lv }/{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
