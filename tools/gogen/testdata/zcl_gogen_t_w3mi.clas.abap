* SMW0 through the host (go/abap/w3mi.go), A4H 2026-09-23, probe of the
* same name in $ZOSG_TMP_0230. A4H answered, over an object of the system
* picked by its filesize (more than 600 bytes, not a multiple of 255):
*   miss:2/1 rel:1/0 hit:0 rowsdiff:0 pad:00/255 exact:0/X five:5/X
*   zero:0 over:0/0 neg:0/0 empty:0/0
* WWWDATA_IMPORT of an unknown object is IMPORT_ERROR and leaves MIME as it
* was; a RELID other than MI is WRONG_OBJECT_TYPE; a hit replaces the rows,
* x(255), the last padded 00. SCMS_BINARY_TO_XSTRING cuts to INPUT_LENGTH,
* gives nothing for 0 or less, everything for more than there is, and
* clears BUFFER for an empty table. The copy reads a 600-byte object of
* testdata/media and checks the bytes row by row instead of by
* CONCATENATE IN BYTE MODE, which the subset does not have, prefills MIME
* with an initial row instead of 'FF' and gives BUFFER a row instead of
* 'AB' (no c -> x in the subset) and compares bytes as their hex (no
* comparison of xstrings in the subset); the A4H probe found its object with a
* SELECT on WWWPARAMS.
CLASS zcl_gogen_t_w3mi DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_w3mi IMPLEMENTATION.
  METHOD run.
    DATA lt_mime TYPE STANDARD TABLE OF w3mime.
    DATA ls_row TYPE w3mime.
    DATA ls_key TYPE wwwdatatab.
    DATA lv_x TYPE xstring.
    DATA lv_size TYPE i VALUE 600.
    DATA lv_rest TYPE i.
    DATA lv_rows TYPE i.
    DATA lv_off TYPE i.
    DATA lv_ok TYPE c LENGTH 1.
    DATA lv_b TYPE x LENGTH 1.
    DATA lv_line TYPE xstring.

    ls_key-relid = 'MI'.
    ls_key-objid = 'ZGOGEN_NO_SUCH_OBJECT'.
    APPEND ls_row TO lt_mime.
    CALL FUNCTION 'WWWDATA_IMPORT' EXPORTING key = ls_key TABLES mime = lt_mime
      EXCEPTIONS wrong_object_type = 1 import_error = 2 OTHERS = 3.
    rv = |miss:{ sy-subrc }/{ lines( lt_mime ) }|.

    ls_key-objid = 'ZGOGEN_T_W3MI.TXT'.
    ls_key-relid = 'XX'.
    CLEAR lt_mime.
    CALL FUNCTION 'WWWDATA_IMPORT' EXPORTING key = ls_key TABLES mime = lt_mime
      EXCEPTIONS wrong_object_type = 1 import_error = 2 OTHERS = 3.
    rv = |{ rv } rel:{ sy-subrc }/{ lines( lt_mime ) }|.

    ls_key-relid = 'MI'.
    CLEAR lt_mime.
    APPEND ls_row TO lt_mime.
    CALL FUNCTION 'WWWDATA_IMPORT' EXPORTING key = ls_key TABLES mime = lt_mime
      EXCEPTIONS wrong_object_type = 1 import_error = 2 OTHERS = 3.
    lv_rows = ( lv_size + 254 ) DIV 255.
    lv_rest = lv_size MOD 255.
    rv = |{ rv } hit:{ sy-subrc } rowsdiff:{ lines( lt_mime ) - lv_rows }|.
    READ TABLE lt_mime INTO ls_row INDEX lines( lt_mime ).
    lv_x = ls_row-line.
    lv_ok = 'X'.
    lv_off = lv_rest.
    WHILE lv_off < xstrlen( lv_x ).
      lv_b = lv_x+lv_off(1).
      IF lv_b IS NOT INITIAL.
        lv_ok = ' '.
      ENDIF.
      lv_off = lv_off + 1.
    ENDWHILE.
    IF lv_ok = 'X'.
      rv = |{ rv } pad:00/{ xstrlen( lv_x ) }|.
    ELSE.
      rv = |{ rv } pad:other/{ xstrlen( lv_x ) }|.
    ENDIF.

    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = lv_size IMPORTING buffer = lv_x TABLES binary_tab = lt_mime.
    lv_ok = 'X'.
    lv_off = 0.
    LOOP AT lt_mime INTO ls_row.
      lv_line = ls_row-line.
      IF lv_off + 255 <= lv_size.
        IF |{ lv_x+lv_off(255) }| <> |{ lv_line }|.
          lv_ok = ' '.
        ENDIF.
      ELSEIF |{ lv_x+lv_off(lv_rest) }| <> |{ lv_line(lv_rest) }|.
        lv_ok = ' '.
      ENDIF.
      lv_off = lv_off + 255.
    ENDLOOP.
    rv = |{ rv } exact:{ xstrlen( lv_x ) - lv_size }/{ lv_ok }|.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = 5 IMPORTING buffer = lv_x TABLES binary_tab = lt_mime.
    READ TABLE lt_mime INTO ls_row INDEX 1.
    lv_ok = ' '.
    lv_line = ls_row-line.
    IF |{ lv_x }| = |{ lv_line(5) }|.
      lv_ok = 'X'.
    ENDIF.
    rv = |{ rv } five:{ xstrlen( lv_x ) }/{ lv_ok }|.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = 0 IMPORTING buffer = lv_x TABLES binary_tab = lt_mime.
    rv = |{ rv } zero:{ xstrlen( lv_x ) }|.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = lv_rows * 255 + 300 IMPORTING buffer = lv_x TABLES binary_tab = lt_mime
      EXCEPTIONS failed = 1 OTHERS = 2.
    rv = |{ rv } over:{ sy-subrc }/{ xstrlen( lv_x ) - lv_rows * 255 }|.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = -3 IMPORTING buffer = lv_x TABLES binary_tab = lt_mime
      EXCEPTIONS failed = 1 OTHERS = 2.
    rv = |{ rv } neg:{ sy-subrc }/{ xstrlen( lv_x ) }|.
    lv_x = ls_row-line.
    CLEAR lt_mime.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING' EXPORTING input_length = 4 IMPORTING buffer = lv_x TABLES binary_tab = lt_mime
      EXCEPTIONS failed = 1 OTHERS = 2.
    rv = |{ rv } empty:{ sy-subrc }/{ xstrlen( lv_x ) }|.
  ENDMETHOD.
ENDCLASS.
