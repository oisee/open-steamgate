INTERFACE if_abap_daemon_context PUBLIC.
  METHODS stop IMPORTING i_parameter TYPE REF TO if_ac_message_type_pcp OPTIONAL RAISING cx_abap_daemon_error.
  METHODS get_instance_id RETURNING VALUE(r_instance_id) TYPE string RAISING cx_abap_daemon_error.
  METHODS get_start_parameter RETURNING VALUE(r_parameter) TYPE REF TO if_ac_message_type_pcp RAISING cx_abap_daemon_error.
ENDINTERFACE.
