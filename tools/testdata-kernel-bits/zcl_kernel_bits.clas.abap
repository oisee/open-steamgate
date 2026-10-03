CLASS zcl_kernel_bits DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS forms.
ENDCLASS.
CLASS zcl_kernel_bits IMPLEMENTATION.
  METHOD forms.
    DATA a TYPE i.
    DATA b TYPE int8.
    a = a BIT-AND a.
    b = b BIT-OR b.
    a = a BIT-XOR a.
    b = BIT-NOT b.
  ENDMETHOD.
ENDCLASS.
