CLASS zcl_gogen_t_genidx DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             a TYPE c LENGTH 3,
             n TYPE i,
           END OF ty_row.
    TYPES tt_row TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_genidx IMPLEMENTATION.
  METHOD run.
    DATA lr TYPE REF TO data.
    DATA ls_row TYPE ty_row.
    DATA lt_rows TYPE tt_row.
    FIELD-SYMBOLS <lt> TYPE STANDARD TABLE.
    FIELD-SYMBOLS <ls> TYPE any.
    FIELD-SYMBOLS <lv> TYPE any.

    DO 4 TIMES.
      ls_row-n = sy-index.
      APPEND ls_row TO lt_rows.
    ENDDO.
    CREATE DATA lr TYPE tt_row.
    ASSIGN lr->* TO <lt>.
    <lt> = lt_rows.
    DELETE <lt> INDEX 1.
    rv = |d1:{ sy-subrc }/{ lines( <lt> ) }|.
    DELETE <lt> INDEX 9.
    rv = |{ rv } d9:{ sy-subrc }/{ lines( <lt> ) }|.
    READ TABLE <lt> INDEX 2 ASSIGNING <ls>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } r2:{ sy-subrc }/{ sy-tabix }/{ <lv> }|.
    <lv> = 30.
    READ TABLE <lt> INDEX 7 ASSIGNING <ls>.
    rv = |{ rv } r7:{ sy-subrc }|.
    ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
    rv = |{ rv } kept:{ <lv> }|.
    DELETE <lt> INDEX 3.
    LOOP AT <lt> ASSIGNING <ls>.
      ASSIGN COMPONENT 'N' OF STRUCTURE <ls> TO <lv>.
      rv = |{ rv } { <lv> }|.
    ENDLOOP.
    rv = |{ rv } orig:{ lines( lt_rows ) }|.
  ENDMETHOD.
ENDCLASS.
