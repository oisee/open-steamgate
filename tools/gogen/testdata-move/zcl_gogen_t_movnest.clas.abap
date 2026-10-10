* A caller binds a field symbol into a table nested in a row of obj->items,
* then calls a method that moves items and clears it (044 critic round 3):
* the move must keep its clone.
CLASS zcl_gogen_t_movnest DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_nums TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_row, items TYPE ty_nums, END OF ty_row.
    TYPES ty_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    DATA items TYPE ty_rows.
    METHODS take RETURNING VALUE(result) TYPE REF TO zcl_gogen_t_movnest.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.

CLASS zcl_gogen_t_movnest IMPLEMENTATION.
  METHOD take.
    result = NEW #( ).
    result->items = items.
    CLEAR items.
  ENDMETHOD.
  METHOD run.
    DATA obj TYPE REF TO zcl_gogen_t_movnest.
    DATA result TYPE REF TO zcl_gogen_t_movnest.
    DATA row TYPE ty_row.
    FIELD-SYMBOLS <n> TYPE i.
    obj = NEW #( ).
    APPEND 1 TO row-items.
    APPEND row TO obj->items.
    LOOP AT obj->items[ 1 ]-items ASSIGNING <n>.
      result = obj->take( ).
      <n> = 99.
      rv = result->items[ 1 ]-items[ 1 ].
      EXIT.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
