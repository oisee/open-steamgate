INTERFACE if_bali_log_db PUBLIC.
  TYPES ty_log_table TYPE STANDARD TABLE OF REF TO if_bali_log WITH EMPTY KEY.
  METHODS save_log
    IMPORTING log TYPE REF TO if_bali_log
              use_2nd_db_connection TYPE abap_bool DEFAULT abap_false
              assign_to_current_appl_job TYPE abap_bool DEFAULT abap_false
    RAISING cx_bali_runtime.
  METHODS save_log_2nd_db_connection
    IMPORTING log TYPE REF TO if_bali_log
              assign_to_current_appl_job TYPE abap_bool DEFAULT abap_false
    RAISING cx_bali_runtime.
  METHODS load_log
    IMPORTING handle TYPE if_bali_log=>ty_handle
              read_only_header TYPE abap_bool DEFAULT abap_false
    RETURNING VALUE(log) TYPE REF TO if_bali_log
    RAISING cx_bali_runtime.
  METHODS load_logs_via_filter
    IMPORTING filter TYPE REF TO if_bali_log_filter
              read_only_header TYPE abap_bool DEFAULT abap_false
    RETURNING VALUE(log_table) TYPE ty_log_table
    RAISING cx_bali_runtime.
ENDINTERFACE.
