INTERFACE if_abap_daemon_handle PUBLIC.
  METHODS send IMPORTING i_message TYPE REF TO if_ac_message_type_pcp OPTIONAL RAISING cx_abap_daemon_error.
ENDINTERFACE.
