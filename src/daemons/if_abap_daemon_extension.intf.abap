INTERFACE if_abap_daemon_extension PUBLIC.
  CONSTANTS: BEGIN OF co_setup_mode,
               accept TYPE i VALUE 1,
               reject TYPE i VALUE 2,
               server_shutdown TYPE i VALUE 3,
               system_shutdown TYPE i VALUE 4,
               max_daemons_reached TYPE i VALUE 5,
               server_not_ready TYPE i VALUE 6,
               s_start_auth_failed TYPE i VALUE 7,
               reject_offset TYPE i VALUE 1000,
             END OF co_setup_mode,
             BEGIN OF co_on_error_code,
               others TYPE i VALUE 100,
               error_message TYPE i VALUE 101,
               abort_message TYPE i VALUE 102,
               runtime_error TYPE i VALUE 103,
               cancel TYPE i VALUE 104,
             END OF co_on_error_code,
             BEGIN OF co_on_before_restart_syst_code,
               manually_by_admin TYPE i VALUE 201,
               program_version_changed TYPE i VALUE 202,
             END OF co_on_before_restart_syst_code.
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
