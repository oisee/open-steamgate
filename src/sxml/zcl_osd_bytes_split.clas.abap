"! One xstring handed out in pieces: a cut at offset n ends a chunk before
"! byte n. Cuts are taken in ascending order; a cut at 0, at or past the
"! end, or equal to the one before it is ignored, so no chunk is empty.
CLASS zcl_osd_bytes_split DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_cuts TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    INTERFACES zif_osd_byte_source.
    METHODS constructor
      IMPORTING
        iv_bytes TYPE xstring
        it_cuts  TYPE ty_cuts.
  PRIVATE SECTION.
    DATA mv_bytes TYPE xstring.
    DATA mt_cuts TYPE ty_cuts.
    DATA mv_pos TYPE i.
ENDCLASS.


CLASS zcl_osd_bytes_split IMPLEMENTATION.

  METHOD constructor.
    DATA lv_cut TYPE i.
    DATA lv_last TYPE i.
    DATA lt_cuts TYPE ty_cuts.
    mv_bytes = iv_bytes.
    lt_cuts = it_cuts.
    SORT lt_cuts.
    LOOP AT lt_cuts INTO lv_cut.
      IF lv_cut > lv_last AND lv_cut < xstrlen( iv_bytes ).
        APPEND lv_cut TO mt_cuts.
        lv_last = lv_cut.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD zif_osd_byte_source~next.
    DATA lv_cut TYPE i.
    DATA lv_len TYPE i.
    IF mv_pos >= xstrlen( mv_bytes ).
      RETURN.
    ENDIF.
    lv_cut = xstrlen( mv_bytes ).
    READ TABLE mt_cuts INDEX 1 INTO lv_cut.
    IF sy-subrc = 0.
      DELETE mt_cuts INDEX 1.
    ELSE.
      lv_cut = xstrlen( mv_bytes ).
    ENDIF.
    lv_len = lv_cut - mv_pos.
    rv = mv_bytes+mv_pos(lv_len).
    mv_pos = lv_cut.
  ENDMETHOD.

ENDCLASS.
