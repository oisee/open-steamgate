CLASS zcl_gogen_t_pdconv DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS c2p IMPORTING iv TYPE csequence RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS s2p IMPORTING iv TYPE string RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS f2p IMPORTING iv TYPE f RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_pdconv IMPLEMENTATION.
  METHOD c2p.
    DATA lv TYPE p LENGTH 3 DECIMALS 2.
    TRY.
        lv = iv.
        rv = |{ lv }|.
      CATCH cx_sy_conversion_no_number.
        rv = `NN`.
      CATCH cx_sy_conversion_overflow.
        rv = `CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = `AO`.
    ENDTRY.
  ENDMETHOD.

  METHOD s2p.
    DATA lv TYPE p LENGTH 3 DECIMALS 2.
    TRY.
        lv = iv.
        rv = |{ lv }|.
      CATCH cx_sy_conversion_no_number.
        rv = `NN`.
      CATCH cx_sy_conversion_overflow.
        rv = `CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = `AO`.
    ENDTRY.
  ENDMETHOD.

  METHOD f2p.
    DATA lv TYPE p LENGTH 3 DECIMALS 2.
    TRY.
        lv = iv.
        rv = |{ lv }|.
      CATCH cx_sy_conversion_no_number.
        rv = `NN`.
      CATCH cx_sy_conversion_overflow.
        rv = `CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = `AO`.
    ENDTRY.
  ENDMETHOD.

  METHOD run.
    DATA lv_p2 TYPE p LENGTH 8 DECIMALS 2.
    DATA lv_p0 TYPE p LENGTH 8 DECIMALS 0.
    DATA lv_p3 TYPE p LENGTH 8 DECIMALS 3.
    DATA lv_small TYPE p LENGTH 3 DECIMALS 2.
    DATA lv_i TYPE i.
    DATA lv_i8 TYPE int8.
    DATA lv_f TYPE f.
    DATA lv_c TYPE c LENGTH 8.
    DATA lv_c3 TYPE c LENGTH 3.
    DATA lv_s TYPE string.
    DATA lv_n TYPE n LENGTH 4.

    rv = |c:{ c2p( '1.235' ) },{ c2p( '-1.235' ) },{ c2p( '1.2349' ) },{ c2p( ' 12.5 ' ) },{ c2p( '12.5-' ) },{ c2p( '+3' ) }|
      && |,{ c2p( '-0' ) },{ c2p( '.5' ) },{ c2p( '5.' ) },{ c2p( '' ) },{ c2p( 'abc' ) },{ c2p( '1,5' ) },{ c2p( '1E2' ) }|
      && |,{ c2p( '999.994' ) },{ c2p( '999.995' ) },{ c2p( '1000' ) },{ c2p( '12 3' ) },{ c2p( '- 1' ) },{ c2p( '0.001' ) },{ c2p( '-0.005' ) }|.
    rv = rv && | s:{ s2p( `1.235` ) },{ s2p( `-7.5` ) },{ s2p( `` ) },{ s2p( `x` ) },{ s2p( ` 2.5 ` ) },{ s2p( `1e1` ) }|.
    rv = rv && | f:{ f2p( '2.345' ) },{ f2p( '2.355' ) },{ f2p( '-2.345' ) },{ f2p( '0.125' ) },{ f2p( '-0.125' ) },{ f2p( '1.005' ) }|
      && |,{ f2p( '999.995' ) },{ f2p( '1000' ) },{ f2p( '0.001' ) },{ f2p( '-0.004' ) },{ f2p( '1E300' ) },{ f2p( '2.675' ) }|.

    lv_i = 7.
    lv_p2 = lv_i.
    rv = rv && | i:{ lv_p2 }|.
    lv_i = -7.
    lv_p2 = lv_i.
    rv = rv && |,{ lv_p2 }|.
    lv_i = 1000.
    TRY.
        lv_small = lv_i.
        rv = rv && |,{ lv_small }|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
    ENDTRY.
    lv_i8 = 5000000000.
    lv_p2 = lv_i8.
    rv = rv && |,{ lv_p2 }|.

    lv_p3 = '1.255'.
    lv_p2 = lv_p3.
    rv = rv && | pp:{ lv_p2 }|.
    lv_p3 = '-1.255'.
    lv_p2 = lv_p3.
    rv = rv && |,{ lv_p2 }|.
    lv_p3 = '1.254'.
    lv_p2 = lv_p3.
    rv = rv && |,{ lv_p2 }|.
    lv_p2 = '2.50'.
    lv_p0 = lv_p2.
    rv = rv && |,{ lv_p0 }|.
    lv_p2 = '-2.50'.
    lv_p0 = lv_p2.
    rv = rv && |,{ lv_p0 }|.
    lv_p2 = '2.49'.
    lv_p0 = lv_p2.
    rv = rv && |,{ lv_p0 }|.
    lv_p3 = '999.995'.
    TRY.
        lv_small = lv_p3.
        rv = rv && |,{ lv_small }|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
    ENDTRY.
    lv_p3 = '999.994'.
    lv_small = lv_p3.
    rv = rv && |,{ lv_small }|.

    lv_p2 = '2.50'.
    lv_i = lv_p2.
    rv = rv && | pi:{ lv_i }|.
    lv_p2 = '-2.50'.
    lv_i = lv_p2.
    rv = rv && |,{ lv_i }|.
    lv_p2 = '2.49'.
    lv_i = lv_p2.
    rv = rv && |,{ lv_i }|.
    lv_p0 = 3000000000.
    TRY.
        lv_i = lv_p0.
        rv = rv && |,{ lv_i }|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `,CO`.
      CATCH cx_sy_arithmetic_overflow.
        rv = rv && `,AO`.
    ENDTRY.
    lv_p2 = '-2.50'.
    lv_i8 = lv_p2.
    rv = rv && |,{ lv_i8 }|.

    lv_p2 = '0.10'.
    lv_f = lv_p2.
    rv = rv && | pf:{ lv_f }|.
    lv_p3 = '-2.675'.
    lv_f = lv_p3.
    rv = rv && |,{ lv_f }|.

    lv_p2 = '1.50'.
    lv_c = lv_p2.
    rv = rv && | pc:[{ lv_c }]|.
    lv_p2 = '-1.50'.
    lv_c = lv_p2.
    rv = rv && |[{ lv_c }]|.
    lv_p2 = '0'.
    lv_c = lv_p2.
    rv = rv && |[{ lv_c }]|.
    lv_p2 = '12345.67'.
    TRY.
        lv_c3 = lv_p2.
        rv = rv && |[{ lv_c3 }]|.
      CATCH cx_sy_conversion_overflow.
        rv = rv && `CO`.
    ENDTRY.
    lv_p2 = '1.50'.
    lv_s = lv_p2.
    rv = rv && | ps:[{ lv_s }]|.
    lv_p2 = '-1.50'.
    lv_s = lv_p2.
    rv = rv && |[{ lv_s }]|.
    lv_p0 = 42.
    lv_s = lv_p0.
    rv = rv && |[{ lv_s }]|.
    lv_p0 = -42.
    lv_s = lv_p0.
    rv = rv && |[{ lv_s }]|.
    lv_p2 = '12.50'.
    lv_n = lv_p2.
    rv = rv && | pn:{ lv_n }|.
  ENDMETHOD.
ENDCLASS.
