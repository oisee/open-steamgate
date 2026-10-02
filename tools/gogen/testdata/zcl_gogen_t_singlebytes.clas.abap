* Unmeasured fixture: expected bytes follow fixed-x fitting and signed i moves.
CLASS zcl_gogen_t_singlebytes DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES byte TYPE x LENGTH 1.
    CLASS-METHODS initial RETURNING VALUE(result) TYPE byte.
    CLASS-METHODS from_byte IMPORTING VALUE(value) TYPE byte RETURNING VALUE(result) TYPE string.
    CLASS-METHODS empty_source RETURNING VALUE(result) TYPE string.
    CLASS-METHODS replace_fit RETURNING VALUE(result) TYPE string.
    CLASS-METHODS run RETURNING VALUE(result) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_singlebytes IMPLEMENTATION.
  METHOD initial.
* Deliberately unassigned RETURNING x(1): its initial value is 00.
  ENDMETHOD.
  METHOD from_byte.
    DATA mem TYPE xstring.
    DATA b TYPE x LENGTH 1.
    b = value.
    mem = 'FF'.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF mem WITH b IN BYTE MODE.
    result = |{ mem }/{ sy-subrc }|.
  ENDMETHOD.
  METHOD empty_source.
    result = from_byte( initial( ) ).
  ENDMETHOD.
  METHOD run.
    DATA mem TYPE xstring.
    DATA b TYPE x LENGTH 1.
    DATA wide TYPE x LENGTH 4.
    DATA saved TYPE x LENGTH 1.
    DATA n TYPE i.
    mem = '007FFF80'.
    b = mem+2(1).
    saved = mem+2(1).
    saved = b.
    n = b.
    result = |{ n }|.
    b = -2.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF mem WITH b IN BYTE MODE.
    wide = mem+3(1).
    n = xstrlen( wide ).
    n = wide.
    result = result && |/{ n }|.
    b = mem+0(1).
    n = b.
    result = result && |/{ n }|.
    n = saved.
    result = result && |/{ n }/{ mem }|.
  ENDMETHOD.
  METHOD replace_fit.
    DATA fixed TYPE x LENGTH 2 VALUE '1234'.
    DATA value TYPE x LENGTH 2 VALUE 'FFFF'.
    DATA mem TYPE xstring.
    REPLACE SECTION OFFSET 1 LENGTH 1 OF fixed WITH value IN BYTE MODE.
    result = |{ fixed }/{ sy-subrc }|.
    mem = '1234'.
    REPLACE SECTION OFFSET 1 OF mem WITH value IN BYTE MODE.
    result = result && |/{ mem }/{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
