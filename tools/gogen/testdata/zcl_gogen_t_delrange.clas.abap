CLASS zcl_gogen_t_delrange DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_delrange IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv TYPE i.
    DO 5 TIMES.
      APPEND sy-index TO lt.
    ENDDO.
    DELETE lt FROM 2 TO 3.
    rv = |{ sy-subrc }/{ lines( lt ) }|.
    READ TABLE lt INDEX 2 INTO lv.
    rv = |{ rv }/{ lv }|.
    DELETE lt FROM 3.
    rv = |{ rv } { sy-subrc }/{ lines( lt ) }|.
    DELETE lt FROM 9.
    rv = |{ rv } { sy-subrc }/{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
