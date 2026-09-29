* LOOP AT / DELETE itab WHERE with a component of a component (param-shape)
* and comp IS [NOT] INITIAL (A4H 2026-09-24, $ZOSG_TMP_0400)
CLASS zcl_gogen_t_loopw DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_loopw IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_p,
             shape TYPE string,
             n     TYPE i,
           END OF ty_p.
    TYPES: BEGIN OF ty_u,
             param TYPE ty_p,
             type  TYPE c LENGTH 4,
           END OF ty_u.
    DATA lt TYPE STANDARD TABLE OF ty_u WITH DEFAULT KEY.
    DATA ls TYPE ty_u.
    ls-param-shape = `table`. ls-param-n = 1. ls-type = ''.
    APPEND ls TO lt.
    ls-param-shape = `field`. ls-param-n = 0. ls-type = 'C'.
    APPEND ls TO lt.
    ls-param-shape = `table`. ls-param-n = 3. ls-type = 'I'.
    APPEND ls TO lt.
    ls-param-shape = ``. ls-param-n = 0. ls-type = ''.
    APPEND ls TO lt.
    rv = `a:`.
    LOOP AT lt INTO ls WHERE param-shape = 'table'.
      rv = rv && |{ sy-tabix }{ ls-param-n };|.
    ENDLOOP.
    rv = rv && ` b:`.
    LOOP AT lt INTO ls WHERE type IS INITIAL.
      rv = rv && |{ sy-tabix };|.
    ENDLOOP.
    rv = rv && ` c:`.
    LOOP AT lt INTO ls WHERE type IS NOT INITIAL AND param-n > 0.
      rv = rv && |{ sy-tabix };|.
    ENDLOOP.
    rv = rv && ` d:`.
    LOOP AT lt INTO ls WHERE param IS INITIAL.
      rv = rv && |{ sy-tabix };|.
    ENDLOOP.
    rv = rv && ` e:`.
    LOOP AT lt INTO ls WHERE param-n IS NOT INITIAL AND param-shape <> 'field'.
      rv = rv && |{ sy-tabix };|.
    ENDLOOP.
    DELETE lt WHERE param-shape IS INITIAL.
    rv = rv && | del:{ sy-subrc }/{ lines( lt ) }|.
    DELETE lt WHERE param-shape = 'none'.
    rv = rv && |/{ sy-subrc }/{ lines( lt ) }|.
  ENDMETHOD.
ENDCLASS.
