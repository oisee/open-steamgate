INTERFACE if_abap_daemon_context_base PUBLIC.
  METHODS get_start_parameter RETURNING VALUE(r_parameter) TYPE REF TO if_ac_message_type_pcp RAISING cx_abap_daemon_error.
ENDINTERFACE.
