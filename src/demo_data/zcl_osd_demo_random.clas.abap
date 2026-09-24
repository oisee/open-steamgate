* A pseudo-random generator that gives the same numbers on every host:
* transpiled on Node and in the browser preview, compiled to Go by
* tools/gogen (OSGo), and on a system. CL_ABAP_RANDOM is not used for
* this: its sequence differs between a system, open-abap-core and the Go
* port.
*
* Park and Miller's minimal standard (CACM 31(10), 1988): x := 16807 * x
* MOD 2147483647, evaluated with Schrage's method (q = 127773, r = 2836),
* so that no intermediate leaves the range of type i and nothing needs
* int8, which 7.02 does not have. Only DIV and MOD with positive operands
* are used: a negative divisor and MOD on packed numbers answer differently
* on the transpiler (ANORMALIES div-mod-negative-divisor, mod-packed-drops-
* fraction), and a / inside an integer expression keeps its fraction there
* (integer-division-not-rounded), so there is none. No type f either.
CLASS zcl_osd_demo_random DEFINITION PUBLIC FINAL CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES ty_ints TYPE STANDARD TABLE OF i WITH DEFAULT KEY.

    CONSTANTS c_m TYPE i VALUE 2147483647.

    " one step of the generator: 16807 * x MOD 2147483647, 1 <= x < m
    CLASS-METHODS step
      IMPORTING
        iv_x        TYPE i
      RETURNING
        VALUE(rv_x) TYPE i.
    " ( iv_sum + iv_value ) MOD m, then a step: a checksum over integers
    CLASS-METHODS fold
      IMPORTING
        iv_sum        TYPE i
        iv_value      TYPE i
      RETURNING
        VALUE(rv_sum) TYPE i.
    " the integers of a blank-separated list: '8 5 3' is 8, 5, 3
    CLASS-METHODS curve
      IMPORTING
        iv_curve       TYPE string
      RETURNING
        VALUE(rt_ints) TYPE ty_ints.
    " index n repeated weight(n) times: PICK from it is a weighted draw
    CLASS-METHODS expand
      IMPORTING
        it_weights     TYPE ty_ints
      RETURNING
        VALUE(rt_pick) TYPE ty_ints.

    " the state from a seed: 1 <= x <= m - 1, then three steps so that near
    " seeds part ways. A negative seed s counts as -1 - s and the result
    " modulo m - 1, so 0, -1 and 2147483646 are one seed; any i is valid
    METHODS constructor
      IMPORTING
        iv_seed TYPE i.
    METHODS next
      RETURNING
        VALUE(rv_x) TYPE i.
    " 0 <= rv_k < iv_n
    METHODS draw
      IMPORTING
        iv_n        TYPE i
      RETURNING
        VALUE(rv_k) TYPE i.
    " a row of an EXPAND table, drawn
    METHODS pick
      IMPORTING
        it_pick         TYPE ty_ints
      RETURNING
        VALUE(rv_index) TYPE i.

  PRIVATE SECTION.
    CONSTANTS c_a TYPE i VALUE 16807.
    CONSTANTS c_q TYPE i VALUE 127773.
    CONSTANTS c_r TYPE i VALUE 2836.

    DATA mv_x TYPE i.
ENDCLASS.



CLASS zcl_osd_demo_random IMPLEMENTATION.

  METHOD step.
    DATA lv_hi TYPE i.
    DATA lv_lo TYPE i.
    lv_hi = iv_x DIV c_q.
    lv_lo = iv_x MOD c_q.
    rv_x = c_a * lv_lo - c_r * lv_hi.
    IF rv_x <= 0.
      rv_x = rv_x + c_m.
    ENDIF.
  ENDMETHOD.

  METHOD fold.
    DATA lv_v TYPE i.
    " ( iv_sum + iv_value ) MOD m without leaving the range of i, then a step
    lv_v = iv_value.
    IF lv_v < 0.
      lv_v = -1 - lv_v.
    ENDIF.
    IF lv_v >= c_m - iv_sum.
      rv_sum = iv_sum - ( c_m - lv_v ).
    ELSE.
      rv_sum = iv_sum + lv_v.
    ENDIF.
    IF rv_sum <= 0.
      rv_sum = 1.
    ENDIF.
    rv_sum = step( rv_sum ).
  ENDMETHOD.

  METHOD curve.
    DATA lt_parts TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_part TYPE string.
    DATA lv_int TYPE i.
    SPLIT iv_curve AT space INTO TABLE lt_parts.
    LOOP AT lt_parts INTO lv_part.
      IF lv_part IS INITIAL.
        CONTINUE.
      ENDIF.
      lv_int = lv_part.
      APPEND lv_int TO rt_ints.
    ENDLOOP.
  ENDMETHOD.

  METHOD expand.
    DATA lv_w TYPE i.
    DATA lv_index TYPE i.
    LOOP AT it_weights INTO lv_w.
      lv_index = sy-tabix.
      DO lv_w TIMES.
        APPEND lv_index TO rt_pick.
      ENDDO.
    ENDLOOP.
  ENDMETHOD.

  METHOD constructor.
    DATA lv_seed TYPE i.
    lv_seed = iv_seed.
    IF lv_seed < 0.
      lv_seed = -1 - lv_seed.
    ENDIF.
    mv_x = lv_seed MOD ( c_m - 1 ) + 1.
    next( ).
    next( ).
    next( ).
  ENDMETHOD.

  METHOD next.
    mv_x = step( mv_x ).
    rv_x = mv_x.
  ENDMETHOD.

  METHOD draw.
    " no range, no draw: 0, and the state stays where it is
    IF iv_n <= 0.
      rv_k = 0.
      RETURN.
    ENDIF.
    rv_k = next( ) MOD iv_n.
  ENDMETHOD.

  METHOD pick.
    DATA lv_n TYPE i.
    lv_n = lines( it_pick ).
    IF lv_n = 0.
      rv_index = 0.
      RETURN.
    ENDIF.
    lv_n = draw( lv_n ) + 1.
    READ TABLE it_pick INTO rv_index INDEX lv_n.
  ENDMETHOD.

ENDCLASS.
