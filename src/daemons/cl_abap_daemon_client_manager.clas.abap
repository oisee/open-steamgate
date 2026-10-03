CLASS cl_abap_daemon_client_manager DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    TYPES tt_info TYPE STANDARD TABLE OF abap_daemon_info WITH DEFAULT KEY.
    CLASS-METHODS start IMPORTING i_class_name TYPE csequence i_name TYPE csequence
      i_parameter TYPE REF TO if_ac_message_type_pcp OPTIONAL
      EXPORTING e_setup_mode TYPE i e_instance_id TYPE string RAISING cx_abap_daemon_error.
    CLASS-METHODS stop IMPORTING i_instance_id TYPE csequence
      i_parameter TYPE REF TO if_ac_message_type_pcp OPTIONAL RAISING cx_abap_daemon_error.
    CLASS-METHODS attach IMPORTING i_instance_id TYPE csequence
      RETURNING VALUE(r_handle) TYPE REF TO if_abap_daemon_handle RAISING cx_abap_daemon_error.
    CLASS-METHODS get_daemon_info IMPORTING i_class_name TYPE csequence
      RETURNING VALUE(r_info_table) TYPE tt_info RAISING cx_abap_daemon_error.
ENDCLASS.
CLASS cl_abap_daemon_client_manager IMPLEMENTATION.
  METHOD start.
    RAISE EXCEPTION TYPE cx_abap_daemon_error.
  ENDMETHOD.
  METHOD stop.
    RAISE EXCEPTION TYPE cx_abap_daemon_error.
  ENDMETHOD.
  METHOD attach.
    RAISE EXCEPTION TYPE cx_abap_daemon_error.
  ENDMETHOD.
  METHOD get_daemon_info.
    RAISE EXCEPTION TYPE cx_abap_daemon_error.
  ENDMETHOD.
ENDCLASS.
