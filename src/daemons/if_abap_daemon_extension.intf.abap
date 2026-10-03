INTERFACE if_abap_daemon_extension PUBLIC.
  METHODS on_accept IMPORTING i_context_base TYPE REF TO if_abap_daemon_context_base EXPORTING e_setup_mode TYPE i.
  METHODS on_start IMPORTING i_context TYPE REF TO if_abap_daemon_context.
  METHODS on_message IMPORTING i_context TYPE REF TO if_abap_daemon_context i_message TYPE REF TO if_ac_message_type_pcp OPTIONAL.
  METHODS on_stop IMPORTING i_context TYPE REF TO if_abap_daemon_context i_message TYPE REF TO if_ac_message_type_pcp OPTIONAL.
  METHODS on_error IMPORTING i_context TYPE REF TO if_abap_daemon_context i_code TYPE i OPTIONAL i_reason TYPE string OPTIONAL.
  METHODS on_restart IMPORTING i_context TYPE REF TO if_abap_daemon_context.
  METHODS on_before_restart_by_system IMPORTING i_context TYPE REF TO if_abap_daemon_context i_code TYPE i OPTIONAL.
  METHODS on_server_shutdown IMPORTING i_context TYPE REF TO if_abap_daemon_context.
  METHODS on_system_shutdown IMPORTING i_context TYPE REF TO if_abap_daemon_context.
ENDINTERFACE.
