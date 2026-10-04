CLASS zcl_bare_bad DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS probe.
ENDCLASS.
CLASS zcl_bare_bad IMPLEMENTATION.
  METHOD probe.
    DATA btcselect TYPE btcselect.
    btcselect-scheduled = 'X'.
  ENDMETHOD.
ENDCLASS.
