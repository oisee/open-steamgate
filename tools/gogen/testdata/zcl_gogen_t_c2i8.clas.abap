* string -> int8 (abapiti 017; A4H $ZABAPITI_TMP_64, 2026-10-03, 3/3:
* ` 42 ` -> 42, `8000000000` -> 8000000000, `-17` -> -17). The rest is
* unmeasured: ParseI's rules with nineteen digits.
CLASS zcl_gogen_t_c2i8 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS conv IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE int8.
ENDCLASS.

CLASS zcl_gogen_t_c2i8 IMPLEMENTATION.
  METHOD conv.
    rv = iv.
  ENDMETHOD.
  METHOD run.
    rv = |{ conv( ` 42 ` ) }/{ conv( `8000000000` ) }/{ conv( `-17` ) }|.
    rv = |{ rv }/{ conv( `9223372036854775807` ) }/{ conv( `-9223372036854775808` ) }|.
    TRY.
        conv( `9223372036854775808` ).
        rv = |{ rv }/no|.
      CATCH cx_sy_conversion_overflow.
        rv = |{ rv }/ovf|.
    ENDTRY.
  ENDMETHOD.
ENDCLASS.
