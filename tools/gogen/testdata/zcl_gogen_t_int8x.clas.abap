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
    DATA b TYPE zgogen_int1.
    DATA s TYPE zgogen_int2.
    DATA x1 TYPE x LENGTH 1.
    DATA x4 TYPE x LENGTH 4.
    DATA x9 TYPE x LENGTH 9.
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

* Supplied oracle and documentation, unmeasured extensions: see NOTES.md.
    num = 0.
    raw = num.
    ASSERT raw = '00'.
    v = 0.
    raw = v.
    ASSERT raw = '00'.
    v = 4294967296.
    raw = v.
    ASSERT raw = '0100000000'.
    v = 1099511627776.
    raw = v.
    ASSERT raw = '010000000000'.
    v = 281474976710656.
    raw = v.
    ASSERT raw = '01000000000000'.
    v = -1.
    raw = v.
    ASSERT raw = 'FFFFFFFFFFFFFFFF'.
    num = -1.
    raw = num.
    ASSERT raw = 'FFFFFFFF'.
    b = 0.
    raw = b.
    ASSERT raw = '00'.
    b = 255.
    raw = b.
    ASSERT raw = 'FF'.
    s = 0.
    raw = s.
    ASSERT raw = '00'.
    s = 32767.
    raw = s.
    ASSERT raw = '7FFF'.
    s = -32768.
    raw = s.
    ASSERT raw = 'FFFF8000'.
    x1 = 'FF'.
    v = 255.
    ASSERT x1 = v.
    ASSERT v = x1.
    v = -1.
    ASSERT x1 > v.
    ASSERT v < x1.
    v = 511.
    ASSERT x1 <> v.
    ASSERT v <> x1.
    x4 = 'FFFFFFFF'.
    num = -1.
    ASSERT x4 = num.
    ASSERT num = x4.
    v = 4294967295.
    ASSERT x4 = v.
    ASSERT v = x4.
    v = -1.
    ASSERT x4 > v.
    x9 = '010000000000000000'.
    v = 0.
    ASSERT x9 = v.
    ASSERT v = x9.
    raw = 'FFFFFFFFFFFFFFFF'.
    v = -1.
    ASSERT raw = v.
    CLEAR raw.
    v = 0.
    ASSERT raw = v.
    rv = |{ rv }/documented|.
  ENDMETHOD.
ENDCLASS.
