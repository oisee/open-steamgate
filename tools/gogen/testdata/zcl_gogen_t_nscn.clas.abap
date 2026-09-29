* NS and CN, the negations of CS and CO; DELETE itab without INDEX inside a
* LOOP deletes the current row (the demo DPC's search) (A4H 2026-09-24,
* $ZOSG_TMP_0400)
CLASS zcl_gogen_t_nscn DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_nscn IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_r,
             id   TYPE c LENGTH 4,
             name TYPE string,
           END OF ty_r.
    DATA lt TYPE STANDARD TABLE OF ty_r WITH DEFAULT KEY.
    DATA ls TYPE ty_r.
    DATA lv_c TYPE c LENGTH 6 VALUE 'Berlin'.
    FIELD-SYMBOLS <l> TYPE ty_r.
    IF lv_c NS 'ERL'. rv = `1`. ELSE. rv = `0`. ENDIF.
    IF lv_c NS 'xyz'. rv = rv && `1`. ELSE. rv = rv && `0`. ENDIF.
    IF lv_c CN 'Berlin'. rv = rv && `1`. ELSE. rv = rv && `0`. ENDIF.
    IF lv_c CN 'Bern'. rv = rv && `1`. ELSE. rv = rv && `0`. ENDIF.
    IF NOT lv_c NS ''. rv = rv && `1`. ELSE. rv = rv && `0`. ENDIF.
    ls-id = 'T1'. ls-name = `Berlin`. APPEND ls TO lt.
    ls-id = 'T2'. ls-name = `Aarhus`. APPEND ls TO lt.
    ls-id = 'T3'. ls-name = `Odense`. APPEND ls TO lt.
    ls-id = 'T4'. ls-name = `Oslo`. APPEND ls TO lt.
    ls-id = 'T5'. ls-name = `Bergen`. APPEND ls TO lt.
    LOOP AT lt ASSIGNING <l>.
      IF to_upper( <l>-name ) NS 'BER' AND to_upper( <l>-id ) NS '2'.
        DELETE lt.
        rv = rv && |-{ sy-tabix }|.
      ENDIF.
    ENDLOOP.
    rv = rv && | { lines( lt ) }:|.
    LOOP AT lt INTO ls.
      rv = rv && |{ ls-id }{ ls-name };|.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
