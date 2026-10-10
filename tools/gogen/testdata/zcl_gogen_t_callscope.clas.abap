* Unmeasured regression: immediate-caller mappings, recursive masking and restore.
CLASS zcl_gogen_t_callscope DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA trace TYPE string.
    CLASS-METHODS run RETURNING VALUE(out) TYPE string.
    CLASS-METHODS recurse IMPORTING depth TYPE i EXCEPTIONS boom.
    CLASS-METHODS classic EXCEPTIONS boom.
    CLASS-METHODS middle EXCEPTIONS boom.
ENDCLASS.
CLASS zcl_gogen_t_callscope IMPLEMENTATION.
  METHOD recurse.
    IF depth > 0.
      recurse( depth = 0 ).
      trace = trace && 'outer'.
    ENDIF.
    MESSAGE ID 'ZZ' TYPE 'S' NUMBER '007' WITH 'nested' RAISING boom.
    trace = trace && 'continue/'.
  ENDMETHOD.
  METHOD classic.
    RAISE boom.
  ENDMETHOD.
  METHOD middle.
    classic( EXCEPTIONS boom = 3 ).
    trace = trace && |{ sy-subrc }/|.
    classic( EXCEPTIONS OTHERS = 0 ).
    trace = trace && |{ sy-subrc }/|.
    RAISE boom.
  ENDMETHOD.
  METHOD run.
    CLEAR trace.
    recurse( EXPORTING depth = 1 EXCEPTIONS boom = 7 ).
    out = trace && |/{ sy-subrc }/{ sy-msgid }/{ sy-msgty }/{ sy-msgno }/{ sy-msgv1 }|.
    recurse( EXPORTING depth = 0 EXCEPTIONS OTHERS = 9 ).
    out = out && |/{ sy-subrc }|.
    middle( EXCEPTIONS boom = 5 ).
    out = out && |/{ trace }/{ sy-subrc }|.
    sy-subrc = 11.
    recurse( depth = 0 ).
    out = out && |/{ sy-subrc }/{ trace }|.
  ENDMETHOD.
ENDCLASS.
