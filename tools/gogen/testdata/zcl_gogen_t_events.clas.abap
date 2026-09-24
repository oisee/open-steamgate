* Class events: EVENTS / CLASS-EVENTS, SET HANDLER (FOR obj, FOR ALL
* INSTANCES, static events, ACTIVATION), RAISE EVENT ... EXPORTING and the
* implicit SENDER. Every handler writes one entry into gv_log:
* <handler name>.<method>(<n>,<sender name>).
CLASS zcl_gogen_t_events DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_gogen_t_evi.
    EVENTS ping EXPORTING VALUE(n) TYPE i OPTIONAL.
    CLASS-EVENTS sping EXPORTING VALUE(n) TYPE i OPTIONAL.

    DATA mv_name TYPE string.
    DATA mv_val TYPE i.
    CLASS-DATA gv_log TYPE string.
    CLASS-DATA go_victim TYPE REF TO zcl_gogen_t_events.
    CLASS-DATA go_late TYPE REF TO zcl_gogen_t_events.

    METHODS constructor IMPORTING name TYPE string.
    METHODS fire IMPORTING n TYPE i.
    METHODS fire_val.
    CLASS-METHODS sfire IMPORTING n TYPE i.

    METHODS on_ping FOR EVENT ping OF zcl_gogen_t_events IMPORTING n sender.
    METHODS on_ping2 FOR EVENT ping OF zcl_gogen_t_events IMPORTING n.
    METHODS on_kill FOR EVENT ping OF zcl_gogen_t_events IMPORTING sender.
    METHODS on_add FOR EVENT ping OF zcl_gogen_t_events IMPORTING sender.
    METHODS on_boom FOR EVENT ping OF zcl_gogen_t_events.
    METHODS on_mod FOR EVENT ping OF zcl_gogen_t_events IMPORTING n sender.
    METHODS on_sping FOR EVENT sping OF zcl_gogen_t_events IMPORTING n.
    CLASS-METHODS on_ping_static FOR EVENT ping OF zcl_gogen_t_events IMPORTING n sender.
    METHODS on_iping FOR EVENT iping OF zif_gogen_t_evi IMPORTING txt sender.

    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_gogen_t_events IMPLEMENTATION.
  METHOD constructor.
    mv_name = name.
  ENDMETHOD.

  METHOD fire.
    RAISE EVENT ping EXPORTING n = n.
  ENDMETHOD.

  METHOD fire_val.
    RAISE EVENT ping EXPORTING n = mv_val.
  ENDMETHOD.

  METHOD sfire.
    RAISE EVENT sping EXPORTING n = n.
  ENDMETHOD.

  METHOD zif_gogen_t_evi~fire.
    RAISE EVENT zif_gogen_t_evi~iping EXPORTING txt = txt.
  ENDMETHOD.

  METHOD on_ping.
    gv_log = |{ gv_log }{ mv_name }.p({ n },{ sender->mv_name })|.
  ENDMETHOD.

  METHOD on_ping2.
    gv_log = |{ gv_log }{ mv_name }.q({ n })|.
  ENDMETHOD.

  METHOD on_kill.
    gv_log = |{ gv_log }{ mv_name }.kill|.
    SET HANDLER go_victim->on_ping FOR sender ACTIVATION space.
  ENDMETHOD.

  METHOD on_add.
    gv_log = |{ gv_log }{ mv_name }.add|.
    SET HANDLER go_late->on_ping FOR sender.
  ENDMETHOD.

  METHOD on_boom.
    gv_log = |{ gv_log }{ mv_name }.boom|.
    RAISE EXCEPTION TYPE zcx_gogen_t_rnochk.
  ENDMETHOD.

  METHOD on_mod.
    sender->mv_val = sender->mv_val + 100.
    gv_log = |{ gv_log }{ mv_name }.m({ n },{ sender->mv_val })|.
  ENDMETHOD.

  METHOD on_sping.
    gv_log = |{ gv_log }{ mv_name }.s({ n })|.
  ENDMETHOD.

  METHOD on_ping_static.
    gv_log = |{ gv_log }static({ n },{ sender->mv_name })|.
  ENDMETHOD.

  METHOD on_iping.
    DATA lo_sender TYPE REF TO zcl_gogen_t_events.
    lo_sender ?= sender.
    gv_log = |{ gv_log }{ mv_name }.i({ txt },{ lo_sender->mv_name })|.
  ENDMETHOD.

  METHOD run.
    DATA s TYPE REF TO zcl_gogen_t_events.
    DATA s2 TYPE REF TO zcl_gogen_t_events.
    DATA a TYPE REF TO zcl_gogen_t_events.
    DATA b TYPE REF TO zcl_gogen_t_events.
    DATA c TYPE REF TO zcl_gogen_t_events.
    DATA li TYPE REF TO zif_gogen_t_evi.
    DATA lv_on TYPE abap_bool.

* no handler: nothing happens
    CREATE OBJECT s EXPORTING name = `s`.
    gv_log = ``.
    s->fire( 1 ).
    rv = |none:[{ gv_log }]|.

* order: two in one statement, then one more; the sender's own name
    CREATE OBJECT a EXPORTING name = `a`.
    CREATE OBJECT b EXPORTING name = `b`.
    CREATE OBJECT c EXPORTING name = `c`.
    SET HANDLER a->on_ping b->on_ping2 FOR s.
    SET HANDLER c->on_ping FOR s.
    gv_log = ``.
    s->fire( 2 ).
    rv = |{ rv } order:{ gv_log }|.

* another sender: not handled
    CREATE OBJECT s2 EXPORTING name = `t`.
    gv_log = ``.
    s2->fire( 3 ).
    rv = |{ rv } other:[{ gv_log }]|.

* registered twice: once
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_ping FOR s.
    SET HANDLER a->on_ping FOR s.
    gv_log = ``.
    s->fire( 4 ).
    rv = |{ rv } twice:{ gv_log }|.

* deactivated and registered again: at its old place or at the end
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_ping FOR s.
    SET HANDLER b->on_ping FOR s.
    SET HANDLER a->on_ping FOR s ACTIVATION space.
    gv_log = ``.
    s->fire( 5 ).
    rv = |{ rv } off:{ gv_log }|.
    SET HANDLER a->on_ping FOR s.
    gv_log = ``.
    s->fire( 6 ).
    rv = |{ rv } again:{ gv_log }|.

* ACTIVATION with a variable
    CREATE OBJECT s EXPORTING name = `s`.
    lv_on = abap_true.
    SET HANDLER a->on_ping FOR s ACTIVATION lv_on.
    lv_on = abap_false.
    SET HANDLER b->on_ping FOR s ACTIVATION lv_on.
    gv_log = ``.
    s->fire( 7 ).
    rv = |{ rv } var:{ gv_log }|.

* a handler deactivates a later one during the dispatch
    CREATE OBJECT s EXPORTING name = `s`.
    go_victim = c.
    SET HANDLER a->on_kill FOR s.
    SET HANDLER c->on_ping FOR s.
    gv_log = ``.
    s->fire( 8 ).
    rv = |{ rv } kill:{ gv_log }|.
    gv_log = ``.
    s->fire( 9 ).
    rv = |{ rv } kill2:{ gv_log }|.

* a handler registers another one during the dispatch
    CREATE OBJECT s EXPORTING name = `s`.
    go_late = c.
    SET HANDLER a->on_add FOR s.
    gv_log = ``.
    s->fire( 10 ).
    rv = |{ rv } add:{ gv_log }|.
    gv_log = ``.
    s->fire( 11 ).
    rv = |{ rv } add2:{ gv_log }|.

* an exception in a handler: the rest of the handlers, the caller
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER a->on_boom FOR s.
    SET HANDLER b->on_ping FOR s.
    gv_log = ``.
    TRY.
        s->fire( 12 ).
        gv_log = |{ gv_log }.after|.
      CATCH zcx_gogen_t_rnochk.
        gv_log = |{ gv_log }.caught|.
    ENDTRY.
    rv = |{ rv } boom:{ gv_log }|.

* the value passed is a copy taken at RAISE EVENT
    CREATE OBJECT s EXPORTING name = `s`.
    s->mv_val = 5.
    SET HANDLER a->on_mod b->on_mod FOR s.
    gv_log = ``.
    s->fire_val( ).
    rv = |{ rv } val:{ gv_log }|.

* FOR ALL INSTANCES: senders made before and after the registration
    CREATE OBJECT s EXPORTING name = `x`.
    SET HANDLER a->on_ping2 FOR ALL INSTANCES.
    CREATE OBJECT s2 EXPORTING name = `y`.
    SET HANDLER b->on_ping FOR s2.
    SET HANDLER c->on_ping FOR ALL INSTANCES.
    gv_log = ``.
    s->fire( 13 ).
    s2->fire( 14 ).
    rv = |{ rv } all:{ gv_log }|.
* the same handler FOR s and FOR ALL INSTANCES
    SET HANDLER c->on_ping FOR s2.
    gv_log = ``.
    s2->fire( 15 ).
    rv = |{ rv } both:{ gv_log }|.
* deactivating FOR s leaves FOR ALL INSTANCES
    SET HANDLER c->on_ping FOR s2 ACTIVATION space.
    gv_log = ``.
    s2->fire( 16 ).
    rv = |{ rv } offone:{ gv_log }|.
    SET HANDLER a->on_ping2 c->on_ping FOR ALL INSTANCES ACTIVATION space.
    gv_log = ``.
    s->fire( 17 ).
    s2->fire( 18 ).
    rv = |{ rv } offall:{ gv_log }|.

* a static handler of an instance event
    CREATE OBJECT s EXPORTING name = `s`.
    SET HANDLER on_ping_static FOR s.
    gv_log = ``.
    s->fire( 19 ).
    rv = |{ rv } stat:{ gv_log }|.
    SET HANDLER zcl_gogen_t_events=>on_ping_static FOR s ACTIVATION space.

* a static event: no FOR
    SET HANDLER a->on_sping b->on_sping.
    gv_log = ``.
    sfire( 20 ).
    rv = |{ rv } sev:{ gv_log }|.
    SET HANDLER a->on_sping ACTIVATION space.
    gv_log = ``.
    sfire( 21 ).
    rv = |{ rv } sev2:{ gv_log }|.
    SET HANDLER b->on_sping ACTIVATION space.

* an event of an interface, the handler registered through a reference to
* the interface
    CREATE OBJECT s EXPORTING name = `s`.
    li = s.
    SET HANDLER a->on_iping FOR li.
    gv_log = ``.
    li->fire( `hi` ).
    rv = |{ rv } intf:{ gv_log }|.
  ENDMETHOD.
ENDCLASS.
