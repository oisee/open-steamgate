CLASS zcl_race_child DEFINITION PUBLIC INHERITING FROM zcl_race_base CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS read RETURNING VALUE(result) TYPE i.
    CLASS-METHODS references RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_race_child IMPLEMENTATION.
  METHOD read.
    result = total.
  ENDMETHOD.
  METHOD references.
    FIELD-SYMBOLS <n> TYPE any.
    FIELD-SYMBOLS <other> TYPE any.
    DATA ref TYPE REF TO data.
    ASSIGN total TO <n>.
    GET REFERENCE OF total INTO ref.
    CLEAR total.
    <n> = 19.
    ASSIGN ref->* TO <other>.
    result = <other>.
  ENDMETHOD.
ENDCLASS.
