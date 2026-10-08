CLASS zcl_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA counter TYPE i.
    CLASS-EVENTS ping.
    EVENTS pong.
    CLASS-METHODS register.
    CLASS-METHODS register_all.
    CLASS-METHODS unregister.
    CLASS-METHODS unregister_all.
    CLASS-METHODS reset.
    CLASS-METHODS fire RETURNING VALUE(n) TYPE i.
    METHODS fire_instance RETURNING VALUE(n) TYPE i.
    METHODS register_instance.
    METHODS on_ping FOR EVENT ping OF zcl_probe.
    METHODS on_pong FOR EVENT pong OF zcl_probe.
  PRIVATE SECTION.
    CLASS-DATA handler TYPE REF TO zcl_probe.
ENDCLASS.
CLASS zcl_probe IMPLEMENTATION.
  METHOD register.
    CREATE OBJECT handler.
    SET HANDLER handler->on_ping.
  ENDMETHOD.
  METHOD register_all.
    CREATE OBJECT handler.
    SET HANDLER handler->on_pong FOR ALL INSTANCES.
  ENDMETHOD.
  METHOD unregister.
    SET HANDLER handler->on_ping ACTIVATION space.
  ENDMETHOD.
  METHOD unregister_all.
    SET HANDLER handler->on_pong FOR ALL INSTANCES ACTIVATION space.
  ENDMETHOD.
  METHOD reset.
    CLEAR counter.
  ENDMETHOD.
  METHOD register_instance.
    CREATE OBJECT handler.
    SET HANDLER handler->on_pong FOR me.
  ENDMETHOD.
  METHOD fire.
    RAISE EVENT ping.
    n = counter.
  ENDMETHOD.
  METHOD fire_instance.
    RAISE EVENT pong.
    n = counter.
  ENDMETHOD.
  METHOD on_ping.
    counter = counter + 1.
  ENDMETHOD.
  METHOD on_pong.
    counter = counter + 1.
  ENDMETHOD.
ENDCLASS.
