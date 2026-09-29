CLASS zcl_gogen_t_rqinit DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_s, num TYPE n LENGTH 3, dat TYPE d, tim TYPE t, txt TYPE c LENGTH 2, END OF ty_s.
    TYPES: BEGIN OF ty_o, s TYPE ty_s, k TYPE i, END OF ty_o.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rqinit IMPLEMENTATION.
  METHOD run.
    DATA ls TYPE ty_s.
    DATA lo TYPE ty_o.
    DATA ln TYPE n LENGTH 3.
    DATA ln5 TYPE n LENGTH 3 VALUE '005'.
    DATA ln0 TYPE n LENGTH 3 VALUE '000'.
    rv = 'a'.
    IF ls-num IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls-dat IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls-tim IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ln IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    ls-num = ln5.
    rv = |{ rv } b|.
    IF ls-num IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    CLEAR ls.
    rv = |{ rv } c|.
    IF ls-num IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls-dat IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls-tim IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    ls-num = ln0.
    ls-dat = '00000000'.
    rv = |{ rv } d|.
    IF ls-num IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    IF ls IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    lo-s-tim = '000000'.
    rv = |{ rv } e|.
    IF lo IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    lo-s-tim = '000001'.
    IF lo IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
    ln = ln5.
    CLEAR ln.
    rv = |{ rv } f|.
    IF ln IS INITIAL. rv = |{ rv }X|. ELSE. rv = |{ rv }-|. ENDIF.
  ENDMETHOD.
ENDCLASS.
