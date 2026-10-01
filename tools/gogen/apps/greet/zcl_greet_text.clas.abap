CLASS zcl_greet_text DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS hello
      IMPORTING iv_name        TYPE string
      RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_greet_text IMPLEMENTATION.
  METHOD hello.
    rv_text = |Hello, { iv_name }!|.
  ENDMETHOD.
ENDCLASS.
