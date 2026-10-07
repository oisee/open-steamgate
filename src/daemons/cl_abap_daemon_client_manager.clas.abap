CLASS cl_abap_daemon_client_manager DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    TYPES tt_info TYPE STANDARD TABLE OF abap_daemon_info WITH DEFAULT KEY.
    CONSTANTS co_session_priority_high TYPE i VALUE 0.
    CONSTANTS co_session_priority_normal TYPE i VALUE 1.
    CONSTANTS co_session_priority_low TYPE i VALUE 2.
    CLASS-METHODS start IMPORTING i_daemon_id TYPE csequence OPTIONAL
      i_class_name TYPE csequence OPTIONAL i_destination TYPE csequence DEFAULT 'NONE'
      i_name TYPE csequence
      i_parameter TYPE REF TO if_ac_message_type_pcp OPTIONAL
      i_priority TYPE i DEFAULT co_session_priority_normal
      EXPORTING e_setup_mode TYPE i e_instance_id TYPE abap_daemon_info-instance_id RAISING cx_abap_daemon_error.
    CLASS-METHODS stop IMPORTING i_instance_id TYPE csequence
      i_parameter TYPE REF TO if_ac_message_type_pcp OPTIONAL RAISING cx_abap_daemon_error.
    CLASS-METHODS attach IMPORTING i_instance_id TYPE csequence
      RETURNING VALUE(r_handle) TYPE REF TO if_abap_daemon_handle RAISING cx_abap_daemon_error.
    CLASS-METHODS get_daemon_info IMPORTING i_daemon_id TYPE csequence OPTIONAL
      i_class_name TYPE csequence OPTIONAL
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
