CLASS zcl_dsl_aliases DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    TYPES ty_small TYPE zlit_int1.
    TYPES ty_small_chain TYPE ty_small.
    TYPES ty_decimal TYPE zlit_dec14.
    CONSTANTS c_small TYPE ty_small VALUE 300.
    CONSTANTS c_chain TYPE ty_small_chain VALUE 300.
    CONSTANTS c_decimal TYPE ty_decimal VALUE '1.25'.
    CONSTANTS c_builtin TYPE i VALUE 42.
ENDCLASS.
CLASS zcl_dsl_aliases IMPLEMENTATION.
ENDCLASS.
