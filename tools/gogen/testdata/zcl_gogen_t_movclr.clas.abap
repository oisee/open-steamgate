CLASS zcl_gogen_t_movclr DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES tt TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    TYPES: BEGIN OF ty_row, items TYPE tt, END OF ty_row.
    TYPES tt_deep TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    DATA items TYPE tt.
    METHODS take RETURNING VALUE(result) TYPE REF TO zcl_gogen_t_movclr.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_movclr IMPLEMENTATION.
  METHOD take.
    CREATE OBJECT result.
    result->items = items.
    CLEAR items.
    DELETE result->items FROM 1 TO 1.
  ENDMETHOD.
  METHOD run.
    DATA a TYPE tt.
    DATA b TYPE tt.
    DATA freed TYPE tt.
    DATA free_src TYPE tt.
    DATA deep_a TYPE tt_deep.
    DATA deep_b TYPE tt_deep.
    DATA row TYPE ty_row.
    DATA loop_src TYPE tt.
    DATA loop_copy TYPE tt.
    DATA n TYPE i.
    DATA component_src TYPE ty_row.
    DATA component_dst TYPE ty_row.
    DATA obj TYPE REF TO zcl_gogen_t_movclr.
    DATA result TYPE REF TO zcl_gogen_t_movclr.
    b = VALUE #( ( 1 ) ( 2 ) ( 3 ) ).
    a = b.
    CLEAR b.
    rv = |clear:{ lines( a ) },{ lines( b ) }|.
    APPEND 9 TO b.
    rv = rv && | append:{ a[ 1 ] },{ b[ 1 ] }|.
    DELETE a FROM 1 TO 1.
    rv = rv && | delete:{ lines( a ) },{ a[ 1 ] }|.
    free_src = VALUE #( ( 4 ) ( 5 ) ).
    freed = free_src.
    FREE free_src.
    APPEND 8 TO free_src.
    rv = rv && | free:{ freed[ 1 ] },{ lines( freed ) },{ free_src[ 1 ] }|.
    row-items = VALUE #( ( 6 ) ( 7 ) ).
    APPEND row TO deep_b.
    deep_a = deep_b.
    CLEAR deep_b.
    row-items = VALUE #( ( 10 ) ).
    APPEND row TO deep_b.
    rv = rv && | deep:{ deep_a[ 1 ]-items[ 1 ] },{ deep_b[ 1 ]-items[ 1 ] }|.
    component_src-items = VALUE #( ( 14 ) ( 15 ) ).
    component_dst-items = component_src-items.
    CLEAR component_src-items.
    APPEND 16 TO component_src-items.
    rv = rv && | component:{ component_dst-items[ 1 ] },{ component_src-items[ 1 ] }|.
    CREATE OBJECT obj.
    obj->items = VALUE #( ( 17 ) ( 18 ) ).
    result = obj->take( ).
    APPEND 19 TO obj->items.
    rv = rv && | object:{ result->items[ 1 ] },{ obj->items[ 1 ] }|.
    loop_src = VALUE #( ( 11 ) ( 12 ) ).
    LOOP AT loop_src INTO n.
      loop_copy = loop_src.
      CLEAR loop_src.
      APPEND 13 TO loop_src.
      EXIT.
    ENDLOOP.
    rv = rv && | loop:{ loop_copy[ 1 ] },{ lines( loop_copy ) },{ loop_src[ 1 ] }|.
  ENDMETHOD.
ENDCLASS.
