CLASS zcl_race_counter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA count TYPE i.
    CLASS-METHODS reset.
    CLASS-METHODS increment RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_race_counter IMPLEMENTATION.
  METHOD reset.
    CLEAR count.
  ENDMETHOD.
  METHOD increment.
    count = count + 1.
    result = count.
  ENDMETHOD.
ENDCLASS.
