* Unmeasured regression: nested classic mappings and class-exception propagation.
CLASS zcl_gogen_t_classicnest DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA trace TYPE string.
    CLASS-METHODS run RETURNING VALUE(out) TYPE string.
    CLASS-METHODS leaf EXCEPTIONS boom.
    CLASS-METHODS middle EXCEPTIONS boom.
    CLASS-METHODS divide.
ENDCLASS.
CLASS zcl_gogen_t_classicnest IMPLEMENTATION.
  METHOD leaf.
    RAISE boom.
  ENDMETHOD.
  METHOD middle.
    leaf( EXCEPTIONS boom = 0 ).
    trace = |{ sy-subrc }/|.
    leaf( EXCEPTIONS OTHERS = 3 ).
    trace = trace && |{ sy-subrc }/|.
    RAISE boom.
  ENDMETHOD.
  METHOD divide.
    DATA zero TYPE i.
    DATA result TYPE i.
    result = 1 / zero.
  ENDMETHOD.
  METHOD run.
    middle( EXCEPTIONS boom = 7 ).
    out = trace && |{ sy-subrc }/|.
    leaf( EXCEPTIONS error_message = 2 OTHERS = 9 ).
    out = out && |{ sy-subrc }/|.
    TRY.
        divide( EXCEPTIONS OTHERS = 5 ).
      CATCH cx_sy_zerodivide.
        out = out && 'class'.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
