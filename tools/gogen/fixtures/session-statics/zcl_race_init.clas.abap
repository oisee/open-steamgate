CLASS zcl_race_init DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA value TYPE i.
    CLASS-METHODS class_constructor.
    CLASS-METHODS read RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_race_init IMPLEMENTATION.
  METHOD class_constructor.
    value = read( ). " Reentrant access must see the guard already set.
    DO 1000000 TIMES.
    ENDDO.
    value = 42.
  ENDMETHOD.
  METHOD read.
    result = value.
  ENDMETHOD.
ENDCLASS.
