* NUMC moves as ZCL_OSD_DEMO_DATA uses them, measured on A4H 2026-09-24
* ($ZOSG_TMP_0462, ultra/demodata): i -> n (sign dropped, the last digits
* kept), c -> n (the digits only, right-aligned), n -> i, n -> string and
* c, n by offset, n in CONCATENATE and in a template, an n constant.
CLASS zcl_gogen_t_numc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS c_min TYPE n LENGTH 10 VALUE '9000000000'.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_numc IMPLEMENTATION.
  METHOD run.
    DATA lv_n10 TYPE n LENGTH 10.
    DATA lv_n9 TYPE n LENGTH 9.
    DATA lv_n3 TYPE n LENGTH 3.
    DATA lv_n2 TYPE n LENGTH 2.
    DATA lv_i TYPE i.
    DATA lv_c10 TYPE c LENGTH 10.
    DATA lv_c8 TYPE c LENGTH 8.
    DATA lv_s TYPE string.
    lv_i = 42.
    lv_n10 = lv_i.
    rv = `i:` && lv_n10.
    lv_i = -5.
    lv_n3 = lv_i.
    rv = rv && `,` && lv_n3.
    lv_i = 123456.
    lv_n3 = lv_i.
    rv = rv && `,` && lv_n3.
    lv_i = 0.
    lv_n2 = lv_i.
    rv = rv && `,` && lv_n2.
    lv_c10 = '9000000001'.
    lv_n10 = lv_c10.
    rv = rv && ` c:` && lv_n10.
    lv_c10 = ' 12'.
    lv_n10 = lv_c10.
    rv = rv && `,` && lv_n10.
    lv_c10 = 'a1b2 3'.
    lv_n3 = lv_c10.
    rv = rv && `,` && lv_n3.
    lv_c10 = '98765'.
    lv_n3 = lv_c10.
    rv = rv && `,` && lv_n3.
    CLEAR lv_c10.
    lv_n3 = lv_c10.
    rv = rv && `,` && lv_n3.
    lv_n10 = '0000000042'.
    lv_i = lv_n10.
    lv_s = lv_i.
    rv = rv && ` ni:` && lv_s.
    lv_s = lv_n10.
    rv = rv && ` ns:[` && lv_s && `]`.
    lv_c8 = lv_n10.
    rv = rv && ` nc:[` && lv_c8 && `]`.
    lv_n10 = '9000000123'.
    lv_i = lv_n10+1(9).
    lv_s = lv_i.
    rv = rv && ` off:` && lv_s.
    lv_n9 = lv_n10+1(9).
    rv = rv && `,` && lv_n9.
    lv_n2 = 7.
    CONCATENATE '202501' lv_n2 INTO lv_c8.
    rv = rv && ` cat:` && lv_c8.
    lv_n9 = 17.
    CONCATENATE '9' lv_n9 INTO lv_c10.
    lv_n10 = lv_c10.
    rv = rv && `,` && lv_n10.
    rv = rv && ` tpl:` && |{ lv_n9 }| && ` const:` && c_min.
    IF lv_n10 > c_min.
      rv = rv && ` gt`.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
