* Class events, third probe (ultra/events fix round): a handler declared
* FOR EVENT e OF a subclass and registered FOR ALL INSTANCES is called for
* senders of that subclass only, one declared OF the class that defines the
* event for senders of both; registered FOR one sender of the subclass, it
* is called for that sender only.
CLASS zcl_gogen_t_events3 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_log TYPE string.
    METHODS on_b FOR EVENT e OF zcl_gogen_t_evb IMPORTING sender.
    METHODS on_s FOR EVENT e OF zcl_gogen_t_evs IMPORTING sender.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_events3 IMPLEMENTATION.
  METHOD on_b.
    gv_log = |{ gv_log }b({ sender->mv_name })|.
  ENDMETHOD.

  METHOD on_s.
    gv_log = |{ gv_log }s({ sender->mv_name })|.
  ENDMETHOD.

  METHOD run.
    DATA h TYPE REF TO zcl_gogen_t_events3.
    DATA lo_b TYPE REF TO zcl_gogen_t_evb.
    DATA lo_s TYPE REF TO zcl_gogen_t_evs.
    DATA lo_s2 TYPE REF TO zcl_gogen_t_evs.
    DATA lo_up TYPE REF TO zcl_gogen_t_evb.
    CREATE OBJECT h.
    CREATE OBJECT lo_b EXPORTING name = `base`.
    CREATE OBJECT lo_s EXPORTING name = `sub`.
    CREATE OBJECT lo_s2 EXPORTING name = `sub2`.
    SET HANDLER h->on_s h->on_b FOR ALL INSTANCES.
    gv_log = ``.
    lo_b->fire( ).
    lo_s->fire( ).
    lo_up = lo_s2.
    lo_up->fire( ).
    rv = |all:{ gv_log }|.
    SET HANDLER h->on_s h->on_b FOR ALL INSTANCES ACTIVATION abap_false.
    SET HANDLER h->on_s FOR lo_s2.
    gv_log = ``.
    lo_b->fire( ).
    lo_s->fire( ).
    lo_s2->fire( ).
    rv = |{ rv } one:{ gv_log }|.
  ENDMETHOD.
ENDCLASS.
