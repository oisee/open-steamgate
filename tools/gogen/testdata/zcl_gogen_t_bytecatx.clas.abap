CLASS zcl_gogen_t_bytecatx DEFINITION PUBLIC FINAL CREATE PUBLIC.
* CONCATENATE ... IN BYTE MODE into an x of fixed length (CL_ABAP_ZIP's
* CRC-32): exact, shorter, longer, and the target among the operands
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_bytecatx IMPLEMENTATION.
  METHOD run.
    CONSTANTS lc_z3 TYPE x LENGTH 3 VALUE '000000'.
    DATA lv_x4 TYPE x LENGTH 4.
    DATA lv_a TYPE x LENGTH 1.
    DATA lv_b TYPE x LENGTH 2.
    DATA lv_xs TYPE xstring.
    DATA lt_i TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv_i TYPE i.

    lv_a = 'AB'.
    READ TABLE lt_i INTO lv_i INDEX 1.
    CONCATENATE lc_z3 lv_a INTO lv_x4 IN BYTE MODE.
    rv = |exact:{ lv_x4 }/{ sy-subrc }|.
    lv_x4 = 'FFFFFFFF'.
    lv_b = 'CDEF'.
    READ TABLE lt_i INTO lv_i INDEX 1.
    CONCATENATE lv_a lv_b INTO lv_x4 IN BYTE MODE.
    rv = |{ rv } short:{ lv_x4 }/{ sy-subrc }|.
    lv_xs = '123456'.
    CONCATENATE lv_b lv_xs INTO lv_x4 IN BYTE MODE.
    rv = |{ rv } long:{ lv_x4 }/{ sy-subrc }|.
    lv_x4 = '01020304'.
    CONCATENATE lv_x4+3(1) lv_x4+2(1) lv_x4+1(1) lv_x4(1) INTO lv_x4 IN BYTE MODE.
    rv = |{ rv } rev:{ lv_x4 }/{ sy-subrc }|.
    lv_xs = 'A1B2C3'.
    lv_i = 1.
    CONCATENATE lc_z3 lv_xs+lv_i(1) INTO lv_x4 IN BYTE MODE.
    rv = |{ rv } sub:{ lv_x4 }/{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
