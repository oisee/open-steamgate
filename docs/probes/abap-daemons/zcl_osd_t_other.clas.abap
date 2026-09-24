CLASS zcl_osd_t_other DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS info_rows RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS send_ver IMPORTING iv_inst TYPE string RETURNING VALUE(rv) TYPE string.
ENDCLASS.



CLASS zcl_osd_t_other IMPLEMENTATION.

  METHOD info_rows.
    TRY.
        rv = |rows={ lines( cl_abap_daemon_client_manager=>get_daemon_info( i_class_name = 'ZCL_OSD_T_DMN' ) ) }|.
      CATCH cx_abap_daemon_error INTO DATA(lx).
        rv = lx->get_text( ).
    ENDTRY.
  ENDMETHOD.

  METHOD send_ver.
    TRY.
        DATA(lo_m) = cl_ac_message_type_pcp=>create( ).
        lo_m->set_field( i_name = 'cmd' i_value = 'ver' ).
        lo_m->set_field( i_name = 'n' i_value = 'from-other-program' ).
        cl_abap_daemon_client_manager=>attach( iv_inst )->send( lo_m ).
        rv = 'sent'.
      CATCH cx_root INTO DATA(lx).
        rv = lx->get_text( ).
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
