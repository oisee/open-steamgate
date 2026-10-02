CLASS zcl_kernel_compat DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA mem TYPE xstring.
    CLASS-METHODS forms.
    CLASS-METHODS output CHANGING val TYPE x.
ENDCLASS.
CLASS zcl_kernel_compat IMPLEMENTATION.
  METHOD output.
    val = '00'.
  ENDMETHOD.
  METHOD forms.
    DATA a TYPE i.
    DATA b TYPE int8.
    DATA bytes TYPE x LENGTH 8.
    DATA local TYPE xstring.
    FIELD-SYMBOLS <mem> TYPE xstring.
    a = a BIT-AND a.
    b = b BIT-OR b.
    a = a BIT-XOR a.
    b = BIT-NOT b.
    local = '0000'.
    local+0(1) = '01'.
    MOVE '02' TO local+0.
    CLEAR local(1).
    zcl_kernel_compat=>mem = local.
    zcl_kernel_compat=>mem+0(1) = '03'.
    ASSIGN local TO <mem>.
    <mem>+0(1) = '04'.
    output( CHANGING val = local+0(1) ).
    bytes = bytes BIT-AND bytes.
    bytes = bytes BIT-OR bytes BIT-XOR bytes.
    bytes = BIT-NOT bytes.
    bytes = local+0(1).
    bytes+0(1) = '05'.
    DATA: BEGIN OF bit, and TYPE x LENGTH 8, END OF bit.
    bit-and = bytes.
    bytes = bit-and BIT-AND bytes.
  ENDMETHOD.
ENDCLASS.
