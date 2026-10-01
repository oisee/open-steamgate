* CONCATENATE LINES OF itab INTO xstr IN BYTE MODE, and x = x + y grown in
* place (abap.AppendBytes): a view taken before an append keeps its bytes,
* and an append to that older view is that view and the new bytes
CLASS zcl_gogen_t_bytelines DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_bytelines IMPLEMENTATION.
  METHOD run.
    DATA lt_pieces TYPE STANDARD TABLE OF xstring WITH DEFAULT KEY.
    DATA lv_piece TYPE xstring.
    DATA lv_all TYPE xstring.
    DATA lv_hist TYPE xstring.
    DATA lv_old TYPE xstring.
    DATA lv_fork TYPE xstring.
    DATA lv_x TYPE x LENGTH 1.
    DATA lv_i TYPE i.
    DATA lv_n TYPE i.

    CONCATENATE LINES OF lt_pieces INTO lv_all IN BYTE MODE.
    lv_n = xstrlen( lv_all ).
    rv = |empty:{ lv_n }/{ sy-subrc }|.
    lv_piece = 'AB'.
    APPEND lv_piece TO lt_pieces.
    CLEAR lv_piece.
    APPEND lv_piece TO lt_pieces.
    lv_piece = 'CDEF'.
    APPEND lv_piece TO lt_pieces.
    CONCATENATE LINES OF lt_pieces INTO lv_all IN BYTE MODE.
    rv = |{ rv } lines:{ lv_all }/{ sy-subrc }|.

    DO 6000 TIMES.
      lv_i = sy-index MOD 256.
      lv_x = lv_i.
      CONCATENATE lv_hist lv_x INTO lv_hist IN BYTE MODE.
      IF sy-index = 5000.
        lv_old = lv_hist.
      ENDIF.
    ENDDO.
    lv_x = 'EE'.
    CONCATENATE lv_old lv_x INTO lv_fork IN BYTE MODE.
    CONCATENATE lv_old lv_x INTO lv_old IN BYTE MODE.
    lv_n = xstrlen( lv_hist ).
    rv = |{ rv } hist:{ lv_n }/{ lv_hist+4999(2) }/{ lv_hist+5999(1) }|.
    lv_n = xstrlen( lv_old ).
    rv = |{ rv } old:{ lv_n }/{ lv_old+4999(2) }|.
    IF lv_fork = lv_old.
      rv = |{ rv } fork:same|.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
