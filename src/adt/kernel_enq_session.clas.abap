"! Host-replaced kernel bridge, installed before generated classes load.
"! Crypto uses Web Crypto in Node and the service worker, never Math.random.
CLASS kernel_enq_session DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS bind
      IMPORTING iv_id TYPE string iv_user TYPE string
      RAISING zcx_osd_adt.
    CLASS-METHODS end IMPORTING iv_id TYPE string.
    CLASS-METHODS context_alive
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_alive) TYPE abap_bool.
    CLASS-METHODS owns
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_ours) TYPE abap_bool.
    CLASS-METHODS session_id
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_id) TYPE string.
    CLASS-METHODS random
      IMPORTING iv_kind TYPE string RETURNING VALUE(rv_value) TYPE string.
ENDCLASS.

CLASS kernel_enq_session IMPLEMENTATION.
  METHOD bind.
    ASSERT 1 = 0.
  ENDMETHOD.
  METHOD end.
    ASSERT 1 = 0.
  ENDMETHOD.
  METHOD context_alive.
    ASSERT 1 = 0.
  ENDMETHOD.
  METHOD owns.
    ASSERT 1 = 0.
  ENDMETHOD.
  METHOD session_id.
    ASSERT 1 = 0.
  ENDMETHOD.
  METHOD random.
    ASSERT 1 = 0.
  ENDMETHOD.
ENDCLASS.
