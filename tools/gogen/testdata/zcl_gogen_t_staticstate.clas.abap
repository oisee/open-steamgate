CLASS zcl_gogen_t_staticstate DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_i TYPE i.
    CLASS-DATA gv_8 TYPE int8.
    CLASS-DATA gv_mem TYPE xstring.
    CLASS-DATA gv_hex TYPE x LENGTH 4.
    CLASS-DATA gv_text TYPE string.
    CLASS-DATA gt_rows TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    CLASS-DATA gv_init TYPE i READ-ONLY.
    CLASS-METHODS class_constructor.
    CLASS-METHODS own_write.
ENDCLASS.
CLASS zcl_gogen_t_staticstate IMPLEMENTATION.
  METHOD class_constructor.
    gv_init = gv_init + 1.
    gv_mem = '00000000'.
    gv_text = 'abcd'.
    gv_i = 41.
  ENDMETHOD.
  METHOD own_write.
    zcl_gogen_t_staticstate=>gv_i = 7.
    zcl_gogen_t_staticstate=>gv_init = 1.
  ENDMETHOD.
ENDCLASS.
