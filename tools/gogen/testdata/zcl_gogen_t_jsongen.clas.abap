CLASS zcl_gogen_t_jsongen DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_row,
             n TYPE i,
             s TYPE string,
           END OF ty_row.
    TYPES ty_tab TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS fill CHANGING data TYPE data rv TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_jsongen IMPLEMENTATION.
  METHOD fill.
* the generic statements /UI2/CL_JSON's deserializer uses on a table
    DATA ref TYPE REF TO data.
    FIELD-SYMBOLS <at> TYPE ANY TABLE.
    FIELD-SYMBOLS <any> TYPE any.
    FIELD-SYMBOLS <c> TYPE any.
    ASSIGN data TO <at>.
    CREATE DATA ref LIKE LINE OF <at>.
    ASSIGN ref->* TO <any>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <any> TO <c>.
    <c> = 7.
    ASSIGN COMPONENT 'S' OF STRUCTURE <any> TO <c>.
    <c> = 'x'.
    INSERT <any> INTO TABLE <at>.
    rv = |{ rv }ins:{ sy-subrc }/{ sy-tabix }/{ lines( <at> ) }|.
* a new line is initial, whatever the last one held
    CREATE DATA ref LIKE LINE OF <at>.
    ASSIGN ref->* TO <any>.
    ASSIGN COMPONENT 'N' OF STRUCTURE <any> TO <c>.
    rv = |{ rv } new:{ <c> }|.
  ENDMETHOD.

  METHOD run.
    DATA lt TYPE ty_tab.
    DATA ls TYPE ty_row.
    DATA value TYPE i.
    DATA lr TYPE REF TO ty_tab.
    DATA lo1 TYPE REF TO zcl_gogen_t_jsongen.
    DATA lo2 TYPE REF TO zcl_gogen_t_jsongen.
    FIELD-SYMBOLS <g> TYPE ANY TABLE.
* a variable may be called value
    value = 3.
    ls-n = 1. ls-s = 'a'. APPEND ls TO lt.
    fill( CHANGING data = lt rv = rv ).
    READ TABLE lt INTO ls INDEX 2.
    rv = |{ rv } value:{ value } lt:{ lines( lt ) } row2:{ ls-n }/{ ls-s }|.
* CREATE DATA of a typed reference: a new, empty table of that type
    CREATE DATA lr.
    ASSIGN lr->* TO <g>.
    rv = |{ rv } cd:{ lines( <g> ) } |.
    fill( CHANGING data = <g> rv = rv ).
    rv = |{ rv } after:{ lines( <g> ) }|.
* two references to one object are equal, to two objects not
    CREATE OBJECT lo1.
    lo2 = lo1.
    IF lo1 = lo2.
      rv = |{ rv } eq|.
    ENDIF.
    CREATE OBJECT lo2.
    IF lo1 <> lo2.
      rv = |{ rv } ne|.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
