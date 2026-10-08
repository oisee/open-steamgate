CLASS zcl_race_base DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA total TYPE i VALUE 7.
    CLASS-DATA stamp TYPE d.
    CLASS-DATA digits TYPE n LENGTH 3.
    CLASS-DATA raw TYPE x LENGTH 2.
    CLASS-METHODS class_constructor.
    CLASS-METHODS owned RETURNING VALUE(result) TYPE i.
  PRIVATE SECTION.
    CLASS-DATA buffer TYPE xstring.
ENDCLASS.
CLASS zcl_race_base IMPLEMENTATION.
  METHOD class_constructor.
    total = total + 1.
  ENDMETHOD.
  METHOD owned.
    DATA bytes TYPE x LENGTH 2 VALUE '0102'.
    CLEAR buffer.
    CONCATENATE buffer bytes INTO buffer IN BYTE MODE.
    result = xstrlen( buffer ).
  ENDMETHOD.
ENDCLASS.
