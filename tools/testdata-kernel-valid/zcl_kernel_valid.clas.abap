CLASS zcl_kernel_valid DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS forms RETURNING VALUE(result) TYPE xstring.
ENDCLASS.
CLASS zcl_kernel_valid IMPLEMENTATION.
  METHOD forms.
    DATA bytes TYPE x LENGTH 2.
    DATA local TYPE xstring.
    DATA: BEGIN OF bit, and TYPE x LENGTH 2, END OF bit.
    local = '1234'.
    bytes = local+0(2).
    bytes = bytes BIT-AND bytes.
    bytes = bytes BIT-OR bytes BIT-XOR bytes.
    bytes+0(1) = '05'.
    bit-and = bytes.
    bytes = bit-and BIT-AND bytes.
    result = bytes.
  ENDMETHOD.
ENDCLASS.
