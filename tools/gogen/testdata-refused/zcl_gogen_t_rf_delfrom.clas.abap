* DELETE TABLE itab FROM wa inside a LOOP over the same table (critic of
* #688): a system steps the loop back and unassigns the loop's field
* symbol, the emitters do neither, so it is refused; inside a loop over
* another table (the ADT front's RESTORE) it compiles.
CLASS zcl_gogen_t_rf_delfrom DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_kv,
             k TYPE i,
             v TYPE string,
           END OF ty_kv.
    TYPES ty_sorted TYPE SORTED TABLE OF ty_kv WITH UNIQUE KEY k.
    TYPES ty_hashed TYPE HASHED TABLE OF ty_kv WITH UNIQUE KEY k.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_rf_delfrom IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE ty_sorted.
    DATA lh TYPE ty_hashed.
    DATA wa TYPE ty_kv.
    FIELD-SYMBOLS <row> TYPE ty_kv.
    LOOP AT lt INTO wa.
      DELETE TABLE lt FROM wa.
    ENDLOOP.
    LOOP AT lt ASSIGNING <row>.
      DELETE TABLE lt FROM <row>.
    ENDLOOP.
    LOOP AT lt INTO wa.
      LOOP AT lh INTO wa.
        DELETE TABLE lt FROM wa.
      ENDLOOP.
    ENDLOOP.
    LOOP AT lt INTO wa.
      DELETE TABLE lh FROM wa.
    ENDLOOP.
    rv = |{ lines( lt ) }{ lines( lh ) }|.
  ENDMETHOD.
ENDCLASS.
