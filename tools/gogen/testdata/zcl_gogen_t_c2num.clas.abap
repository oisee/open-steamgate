CLASS zcl_gogen_t_c2num DEFINITION PUBLIC FINAL CREATE PUBLIC.
* a text moved into an i and into an f: which texts are numbers, and what
* else raises (the entry provider's `Seats = "abc"` in a $batch)
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS to_i
      IMPORTING iv_text   TYPE string
      RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS to_f
      IMPORTING iv_text   TYPE string
      RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_c2num IMPLEMENTATION.
  METHOD to_i.
    DATA lv_i TYPE i.
    TRY.
        lv_i = iv_text.
        rv = |{ lv_i }|.
      CATCH cx_sy_conversion_no_number.
        rv = 'NN'.
      CATCH cx_sy_conversion_overflow.
        rv = 'OV'.
    ENDTRY.
  ENDMETHOD.

  METHOD to_f.
    DATA lv_f TYPE f.
    DATA lv_p TYPE p LENGTH 16 DECIMALS 3.
    TRY.
        lv_f = iv_text.
        lv_p = lv_f.
        rv = |{ lv_p }|.
      CATCH cx_sy_conversion_no_number.
        rv = 'NN'.
      CATCH cx_sy_conversion_overflow.
        rv = 'OV'.
    ENDTRY.
  ENDMETHOD.

  METHOD run.
    DATA lt_text TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_text TYPE string.
    APPEND `12` TO lt_text.
    APPEND ` 12 ` TO lt_text.
    APPEND `-12` TO lt_text.
    APPEND `12-` TO lt_text.
    APPEND `+12` TO lt_text.
    APPEND `2.5` TO lt_text.
    APPEND `-2.5` TO lt_text.
    APPEND `.5` TO lt_text.
    APPEND `5.` TO lt_text.
    APPEND `1E3` TO lt_text.
    APPEND `1e3` TO lt_text.
    APPEND `1.5E+2` TO lt_text.
    APPEND `nan` TO lt_text.
    APPEND `inf` TO lt_text.
    APPEND `Infinity` TO lt_text.
    APPEND `0x10` TO lt_text.
    APPEND `1_0` TO lt_text.
    APPEND `1,5` TO lt_text.
    APPEND `12 3` TO lt_text.
    APPEND `abc` TO lt_text.
    APPEND `` TO lt_text.
    APPEND `   ` TO lt_text.
    APPEND `-` TO lt_text.
    APPEND `3000000000` TO lt_text.
* the second A4H run
    APPEND `12 abc` TO lt_text.
    APPEND `1 2 3` TO lt_text.
    APPEND `- 12` TO lt_text.
    APPEND `12 -` TO lt_text.
    APPEND ` -12 ` TO lt_text.
    APPEND `1E 3` TO lt_text.
    APPEND `E3` TO lt_text.
    APPEND `1E` TO lt_text.
    APPEND `1e+` TO lt_text.
    APPEND `1.5.2` TO lt_text.
    APPEND `+-1` TO lt_text.
    APPEND `--1` TO lt_text.
    APPEND `-1-` TO lt_text.
    APPEND `0012` TO lt_text.
    APPEND `.` TO lt_text.
    APPEND `+` TO lt_text.
    APPEND `2147483647.4` TO lt_text.
    APPEND `2147483647.5` TO lt_text.
    APPEND `-2147483648.5` TO lt_text.
    APPEND `-2147483648.4` TO lt_text.
    APPEND `1.49999` TO lt_text.
    APPEND `12 3 ` TO lt_text.
    APPEND `1E400` TO lt_text.
    APPEND `1E-400` TO lt_text.
    APPEND `1.5E3-` TO lt_text.
    APPEND `1.5D3` TO lt_text.
    APPEND `12a` TO lt_text.
    APPEND `1.e2` TO lt_text.
    APPEND `.5e1` TO lt_text.
    APPEND `1E+03` TO lt_text.
    LOOP AT lt_text INTO lv_text.
      rv = |{ rv }[{ lv_text }]{ to_i( lv_text ) }/{ to_f( lv_text ) } |.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
