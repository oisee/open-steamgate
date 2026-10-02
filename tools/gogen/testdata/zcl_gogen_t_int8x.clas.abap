CLASS zcl_gogen_t_int8x DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_t_int8x IMPLEMENTATION.
  METHOD run.
    DATA v TYPE int8.
    DATA small TYPE x LENGTH 2.
    DATA wide TYPE x LENGTH 16.
    DATA raw TYPE xstring.
    DATA num TYPE i.
    DATA iwide TYPE x LENGTH 8.
    v = -2.
    wide = v.
    rv = |{ wide }|.
    v = wide.
    rv = |{ rv }/{ v }|.
    v = 72623859790382856.
    small = v.
    rv = |{ rv }/{ small }|.
    small = 'FFFF'.
    v = small.
    rv = |{ rv }/{ v }|.
    raw = '018000000000000000'.
    v = raw.
    rv = |{ rv }/{ v }|.
    raw = v.
    rv = |{ rv }/{ raw }|.
    CLEAR raw.
    v = raw.
    rv = |{ rv }/{ v }|.
    num = -2.
    iwide = num.
    rv = |{ rv }/{ iwide }|.
    num = iwide.
    rv = |{ rv }/{ num }|.
    raw = num.
    rv = |{ rv }/{ raw }|.
  ENDMETHOD.
ENDCLASS.
