* Unmeasured: ABAP value semantics, typed-to-generic forwarding (044 round 5).
CLASS zcl_gogen_t_movfwd DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ints TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    TYPES: BEGIN OF row, items TYPE ints, END OF row.
    TYPES rows TYPE STANDARD TABLE OF row WITH EMPTY KEY.
    CLASS-METHODS bind IMPORTING tab TYPE ANY TABLE
      RETURNING VALUE(r) TYPE REF TO data.
    CLASS-METHODS helper IMPORTING tab TYPE ints
      RETURNING VALUE(r) TYPE REF TO data.
    CLASS-METHODS write IMPORTING ptr TYPE REF TO data.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_movfwd IMPLEMENTATION.
  METHOD bind.
    FIELD-SYMBOLS <n> TYPE any.
    LOOP AT tab ASSIGNING <n>.
      GET REFERENCE OF <n> INTO r.
      EXIT.
    ENDLOOP.
  ENDMETHOD.
  METHOD helper.
    r = bind( tab ).
  ENDMETHOD.
  METHOD write.
    FIELD-SYMBOLS <n> TYPE any.
    ASSIGN ptr->* TO <n>.
    <n> = 9.
  ENDMETHOD.
  METHOD run.
    DATA a TYPE rows.
    DATA b TYPE rows.
    DATA r TYPE REF TO data.
    b = VALUE #( ( items = VALUE #( ( 1 ) ) ) ).
    r = helper( b[ 1 ]-items ).
    a = b.
    CLEAR b.
    write( r ).
    rv = |{ a[ 1 ]-items[ 1 ] }|.
  ENDMETHOD.
ENDCLASS.
