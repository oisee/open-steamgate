"! Host-replaced kernel bridge, installed before generated classes load.
"! Without the host, ENQ session operations refuse through a named factory.
CLASS zcl_osd_enq_kernel DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS bind
      IMPORTING iv_id TYPE string iv_user TYPE string
      RETURNING VALUE(rv_bound) TYPE abap_bool
      RAISING zcx_osd_adt.
    CLASS-METHODS end IMPORTING iv_id TYPE string.
    CLASS-METHODS context_alive
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_alive) TYPE abap_bool.
    CLASS-METHODS owns
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_ours) TYPE abap_bool.
    CLASS-METHODS session_id
      IMPORTING iv_id TYPE string RETURNING VALUE(rv_id) TYPE string.
ENDCLASS.

CLASS zcl_osd_enq_kernel IMPLEMENTATION.
  METHOD bind.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lx_error = zcx_osd_adt=>system_not_supported( ).
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD end.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lx_error = zcx_osd_adt=>system_not_supported( ).
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD context_alive.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lx_error = zcx_osd_adt=>system_not_supported( ).
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD owns.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lx_error = zcx_osd_adt=>system_not_supported( ).
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
  METHOD session_id.
    DATA lx_error TYPE REF TO zcx_osd_adt.
    lx_error = zcx_osd_adt=>system_not_supported( ).
    RAISE EXCEPTION lx_error.
  ENDMETHOD.
ENDCLASS.
