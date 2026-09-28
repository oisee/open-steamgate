CLASS cx_bali_runtime DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    DATA reason TYPE string READ-ONLY.
    METHODS constructor IMPORTING iv_reason TYPE string OPTIONAL.
ENDCLASS.

CLASS cx_bali_runtime IMPLEMENTATION.
  METHOD constructor.
    super->constructor( ).
    reason = iv_reason.
  ENDMETHOD.
ENDCLASS.
