CLASS zcl_gogen_t_dataset DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

* X0: the DATASET statements against what A4H answered (docs/dataset.md,
* two throwaway probes, 2026-09-30); the harness gives the Go program a
* temporary write root, and every name here is relative to it.
CLASS zcl_gogen_t_dataset IMPLEMENTATION.
  METHOD run.
    DATA lv_f TYPE string VALUE 'x0.txt'.
    DATA lv_c10 TYPE c LENGTH 10.
    DATA lv_c4 TYPE c LENGTH 4.
    DATA lv_s TYPE string.
    DATA lv_x TYPE xstring.
    DATA lv_x3 TYPE x LENGTH 3.
    DATA lv_len TYPE i.
    DATA lv_pos TYPE i.
    DATA lv_msg TYPE string.
    DATA lv_hex TYPE string.

* a C field loses its trailing blanks in TEXT MODE, a string keeps them
    lv_c10 = 'ab'.
    lv_s = `cd `.
    OPEN DATASET lv_f FOR OUTPUT IN TEXT MODE ENCODING UTF-8.
    TRANSFER lv_c10 TO lv_f.
    TRANSFER lv_s TO lv_f.
    CLOSE DATASET lv_f.
    OPEN DATASET lv_f FOR INPUT IN BINARY MODE.
    READ DATASET lv_f INTO lv_x.
    CLOSE DATASET lv_f.
    lv_hex = lv_x.
    rv = |t:{ lv_hex }|.

* lines, the last without LF, then 4
    lv_x = '610A62'.
    OPEN DATASET lv_f FOR OUTPUT IN BINARY MODE.
    TRANSFER lv_x TO lv_f.
    CLOSE DATASET lv_f.
    OPEN DATASET lv_f FOR INPUT IN TEXT MODE ENCODING UTF-8.
    DO 3 TIMES.
      READ DATASET lv_f INTO lv_s ACTUAL LENGTH lv_len.
      lv_pos = sy-subrc.
      rv = |{ rv } r:{ lv_pos }/{ lv_s }/{ lv_len }|.
    ENDDO.
    GET DATASET lv_f POSITION lv_pos.
    rv = |{ rv } p:{ lv_pos }|.
    CLOSE DATASET lv_f.

* a fixed x(3) read short at the end
    lv_x = '00FF0D0A41'.
    OPEN DATASET lv_f FOR OUTPUT IN BINARY MODE.
    TRANSFER lv_x TO lv_f.
    CLOSE DATASET lv_f.
    OPEN DATASET lv_f FOR INPUT IN BINARY MODE.
    DO 3 TIMES.
      READ DATASET lv_f INTO lv_x3 ACTUAL LENGTH lv_len.
      lv_hex = lv_x3.
      rv = |{ rv } x:{ sy-subrc }/{ lv_hex }/{ lv_len }|.
    ENDDO.
    CLOSE DATASET lv_f.

* a C field in BINARY MODE is UTF-16LE at its full length
    lv_c4 = 'ab'.
    OPEN DATASET lv_f FOR OUTPUT IN BINARY MODE.
    TRANSFER lv_c4 TO lv_f.
    CLOSE DATASET lv_f.
    OPEN DATASET lv_f FOR INPUT IN BINARY MODE.
    READ DATASET lv_f INTO lv_x.
    CLOSE DATASET lv_f.
    lv_hex = lv_x.
    rv = |{ rv } c:{ lv_hex }|.

* a missing file, TRANSFER to a file not open
    OPEN DATASET 'none.txt' FOR INPUT IN TEXT MODE ENCODING UTF-8 MESSAGE lv_msg.
    rv = |{ rv } m:{ sy-subrc }/{ lv_msg }|.
    TRY.
        TRANSFER lv_s TO 'none.txt'.
      CATCH cx_sy_file_open_mode.
        rv = |{ rv } e:open_mode|.
    ENDTRY.
    DELETE DATASET lv_f.
    rv = |{ rv } d:{ sy-subrc }|.
  ENDMETHOD.
ENDCLASS.
