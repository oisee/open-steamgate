* Class events, second probe: a handler that reactivates a later one during
* the dispatch, handlers FOR one sender against FOR ALL INSTANCES whatever
* the order they were registered in, a handler that raises the event again
* on its sender (nested), one that deactivates itself, and where a new
* registration goes after others were deactivated.
CLASS zcl_gogen_t_events2 DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    EVENTS ping EXPORTING VALUE(n) TYPE i OPTIONAL.
    DATA mv_name TYPE string.
    CLASS-DATA gv_log TYPE string.
    CLASS-DATA go_victim TYPE REF TO zcl_gogen_t_events2.

    METHODS constructor IMPORTING name TYPE string.
    METHODS fire IMPORTING n TYPE i.
    METHODS on_ping FOR EVENT ping OF zcl_gogen_t_events2 IMPORTING n sender.
    METHODS on_ping2 FOR EVENT ping OF zcl_gogen_t_events2 IMPORTING n.
    METHODS on_revive FOR EVENT ping OF zcl_gogen_t_events2 IMPORTING sender.
    METHODS on_nest FOR EVENT ping OF zcl_gogen_t_events2 IMPORTING n sender.
    METHODS on_self FOR EVENT ping OF zcl_gogen_t_events2 IMPORTING n sender.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
  PROTECTED SECTION.
ENDCLASS.

CLASS zcl_gogen_t_events2 IMPLEMENTATION.
  METHOD constructor.
    mv_name = name.
  ENDMETHOD.

  METHOD fire.
    RAISE EVENT ping EXPORTING n = n.
  ENDMETHOD.

  METHOD on_ping.
    gv_log = |{ gv_log }{ mv_name }.p({ n },{ sender->mv_name })|.
  ENDMETHOD.

  METHOD on_ping2.
    gv_log = |{ gv_log }{ mv_name }.q({ n })|.
  ENDMETHOD.

  METHOD on_revive.
    gv_log = |{ gv_log }{ mv_name }.revive|.
    SET HANDLER go_victim->on_ping FOR sender.
  ENDMETHOD.

  METHOD on_nest.
    gv_log = |{ gv_log }{ mv_name }.n{ n }(|.
    IF n < 2.
      sender->fire( n + 1 ).
    ENDIF.
    gv_log = |{ gv_log })|.
  ENDMETHOD.

  METHOD on_self.
    gv_log = |{ gv_log }{ mv_name }.self{ n }|.
    SET HANDLER on_self FOR sender ACTIVATION space.
  ENDMETHOD.

  METHOD run.
    DATA s TYPE REF TO zcl_gogen_t_events2.
    DATA a TYPE REF TO zcl_gogen_t_events2.
    DATA b TYPE REF TO zcl_gogen_t_events2.
    DATA c TYPE REF TO zcl_gogen_t_events2.

    CREATE OBJECT a EXPORTING name = `a`.
    CREATE OBJECT b EXPORTING name = `b`.
    CREATE OBJECT c EXPORTING name = `c`.

* a later handler, deactivated, reactivated by an earlier one while the
* event is dispatched
    CREATE OBJECT s EXPORTING name = `s`.
    go_victim = c.
    SET HANDLER a->on_revive FOR s.
    SET HANDLER c->on_ping FOR s.
    SET HANDLER c->on_ping FOR s ACTIVATION space.
    gv_log = ``.
    s->fire( 1 ).
    rv = |revive:{ gv_log }|.

* FOR ALL INSTANCES registered first, then FOR s
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER c->on_ping FOR ALL INSTANCES.
    SET HANDLER b->on_ping FOR s.
    gv_log = ``.
    s->fire( 2 ).
    rv = |{ rv } allfirst:{ gv_log }|.
    SET HANDLER c->on_ping FOR ALL INSTANCES ACTIVATION space.

* the event raised again from a handler
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_nest b->on_ping FOR s.
    gv_log = ``.
    s->fire( 1 ).
    rv = |{ rv } nest:{ gv_log }|.

* a handler that deactivates itself
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_self b->on_ping FOR s.
    gv_log = ``.
    s->fire( 3 ).
    s->fire( 4 ).
    rv = |{ rv } self:{ gv_log }|.

* registered against the order the handler objects were made in
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER c->on_ping FOR s.
    SET HANDLER a->on_ping FOR s.
    SET HANDLER b->on_ping2 FOR s.
    SET HANDLER b->on_ping FOR s.
    gv_log = ``.
    s->fire( 5 ).
    rv = |{ rv } rev:{ gv_log }|.

* deactivated, another registered, the first registered again
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER c->on_ping FOR s.
    SET HANDLER b->on_ping FOR s.
    SET HANDLER c->on_ping FOR s ACTIVATION space.
    SET HANDLER a->on_ping FOR s.
    SET HANDLER c->on_ping FOR s.
    gv_log = ``.
    s->fire( 6 ).
    rv = |{ rv } back:{ gv_log }|.

* two places freed, the first one first: where the next two go
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_ping b->on_ping c->on_ping FOR s.
    SET HANDLER a->on_ping FOR s ACTIVATION space.
    SET HANDLER c->on_ping FOR s ACTIVATION space.
    SET HANDLER b->on_ping2 FOR s.
    SET HANDLER a->on_ping2 FOR s.
    gv_log = ``.
    s->fire( 7 ).
    rv = |{ rv } holes:{ gv_log }|.
* the same, the last one freed first
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_ping b->on_ping c->on_ping FOR s.
    SET HANDLER c->on_ping FOR s ACTIVATION space.
    SET HANDLER a->on_ping FOR s ACTIVATION space.
    SET HANDLER b->on_ping2 FOR s.
    SET HANDLER a->on_ping2 FOR s.
    gv_log = ``.
    s->fire( 8 ).
    rv = |{ rv } holes2:{ gv_log }|.
  ENDMETHOD.
ENDCLASS.
