CLASS zcl_gogen_t_crdata DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             a TYPE c LENGTH 3,
             n TYPE i,
           END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_crdata IMPLEMENTATION.
  METHOD run.
    DATA r1 TYPE REF TO data.
    DATA r2 TYPE REF TO data.
    DATA r3 TYPE REF TO data.
    DATA r4 TYPE REF TO data.
    DATA ls_row TYPE ty_row.
    DATA lt_rows TYPE tt_row.
    FIELD-SYMBOLS <lt> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls> TYPE any.
    FIELD-SYMBOLS <lv> TYPE any.

    CREATE DATA r1 TYPE STANDARD TABLE OF t000.
    ASSIGN r1->* TO <lt>.
    rv = |t000:{ lines( <lt> ) }|.

    CREATE DATA r2 TYPE tt_row.
    ASSIGN r2->* TO <lt>.
    ls_row-a = 'abc'.
    ls_row-n = 7.
    APPEND ls_row TO lt_rows.
    <lt> = lt_rows.
    rv = |{ rv } tt:{ lines( <lt> ) }|.
    CREATE DATA r3 TYPE tt_row.
    ASSIGN r3->* TO <lt>.
    rv = |{ rv } fresh:{ lines( <lt> ) }|.
    ASSIGN r2->* TO <lt>.
    rv = |{ rv } kept:{ lines( <lt> ) }|.

    CREATE DATA r4 TYPE ty_row.
    ASSIGN r4->* TO <ls>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } n0:{ <lv> }|.
    <lv> = 42.
    ASSIGN r4->* TO <ls>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } n1:{ <lv> }|.
    CREATE DATA r4 TYPE ty_row.
    ASSIGN r4->* TO <ls>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } n2:{ <lv> }|.
  ENDMETHOD.
ENDCLASS.
