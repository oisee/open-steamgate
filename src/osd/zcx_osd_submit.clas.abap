CLASS zcx_osd_submit DEFINITION PUBLIC INHERITING FROM cx_no_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA detail TYPE string READ-ONLY.
    METHODS constructor IMPORTING iv_detail TYPE string.
    METHODS if_message~get_text REDEFINITION.
ENDCLASS.

CLASS zcx_osd_submit IMPLEMENTATION.
  METHOD constructor.
    super->constructor( ).
    detail = iv_detail.
  ENDMETHOD.

  METHOD if_message~get_text.
    result = detail.
  ENDMETHOD.
ENDCLASS.
