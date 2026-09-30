CLASS zcx_osd_inflate DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    DATA reason TYPE string READ-ONLY.
    METHODS constructor IMPORTING iv_reason TYPE string OPTIONAL.
    METHODS get_text REDEFINITION.
ENDCLASS.

CLASS zcx_osd_inflate IMPLEMENTATION.
  METHOD constructor.
    super->constructor( ).
    reason = iv_reason.
  ENDMETHOD.

  METHOD get_text.
    result = reason.
  ENDMETHOD.
ENDCLASS.
