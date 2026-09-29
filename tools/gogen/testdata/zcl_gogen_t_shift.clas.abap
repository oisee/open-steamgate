CLASS zcl_gogen_t_shift DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS one IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_shift IMPLEMENTATION.
  METHOD one.
    DATA lv TYPE string.
    DATA lv_vis TYPE string.
    lv = iv.
    SHIFT lv RIGHT DELETING TRAILING cl_abap_char_utilities=>newline.
    lv_vis = lv.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_vis WITH 'N'.
    REPLACE ALL OCCURRENCES OF ` ` IN lv_vis WITH '_'.
    rv = |{ strlen( lv ) }[{ lv_vis }]|.
  ENDMETHOD.

  METHOD run.
    DATA nl TYPE string.
    nl = cl_abap_char_utilities=>newline.
    rv = |1:{ one( `ab` && nl && nl ) } 2:{ one( `ab ` && nl ) } 3:{ one( `ab` ) } 4:{ one( `` ) }|
      && | 5:{ one( `a` && nl && `b` && nl ) } 6:{ one( nl ) } 7:{ one( `ab` && nl && ` ` ) } 8:{ one( `  ab` && nl ) }|.
  ENDMETHOD.
ENDCLASS.
