CLASS zcl_osd_apc_store_probe DEFINITION PUBLIC INHERITING FROM cl_apc_wsp_ext_stateful_base FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS if_apc_wsp_extension~on_start REDEFINITION.
    METHODS if_apc_wsp_extension~on_message REDEFINITION.
    METHODS if_apc_wsp_extension~on_close REDEFINITION.
  PRIVATE SECTION.
    DATA mv_operation TYPE string.
    METHODS send IMPORTING io_manager TYPE REF TO if_apc_wsp_message_manager iv_text TYPE string.
ENDCLASS.

CLASS zcl_osd_apc_store_probe IMPLEMENTATION.
  METHOD if_apc_wsp_extension~on_start.
    send( io_manager = i_message_manager iv_text = 'ready' ).
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_message.
    DATA lv_command TYPE string.
    DATA ls_answer TYPE zcl_osd_adt_host=>ty_answer.
    DATA lo_json TYPE REF TO zcl_ajson.
    DATA lv_generation TYPE string.
    DATA lv_tests TYPE string.
    lv_command = i_message->get_text( ).
    IF strlen( lv_command ) > 7.
      IF lv_command(7) = 'lookup:'.
        mv_operation = lv_command+7.
        lv_command = 'status'.
      ENDIF.
    ENDIF.
    CASE lv_command.
      WHEN 'activate' OR 'dump'.
        ls_answer = zcl_osd_adt_host=>store( iv_command = 'ACTIVATE'
          iv_type = 'CLAS' iv_name = 'ZCL_APC_STORE_TARGET' ).
        lo_json = zcl_ajson=>parse( ls_answer-json ).
        mv_operation = lo_json->get_string( '/op_id' ).
        send( io_manager = i_message_manager iv_text = ls_answer-json ).
        IF lv_command = 'dump'.
          DELETE FROM zosd_job_seen WHERE run_id = 'APC_STEP_PROBE'.
          ASSERT 1 = 2.
        ENDIF.
      WHEN 'tests' OR 'status'.
        ls_answer = zcl_osd_adt_host=>store( iv_command = 'ACTIVATION_STATUS'
          iv_json = |\{"op_id":"{ mv_operation }"\}| ).
        send( io_manager = i_message_manager iv_text = ls_answer-json ).
        IF lv_command = 'status'.
          RETURN.
        ENDIF.
        lo_json = zcl_ajson=>parse( ls_answer-json ).
        lv_generation = lo_json->get_string( '/generation_id' ).
        IF lv_generation IS INITIAL.
          lv_tests = '{"targets":[{"type":"CLAS","name":"ZCL_APC_STORE_TARGET"}]}'.
        ELSE.
          lv_tests = |\{"targets":[\{"type":"CLAS","name":"ZCL_APC_STORE_TARGET"\}],"expected_generation":"{ lv_generation }"\}|.
        ENDIF.
        ls_answer = zcl_osd_adt_host=>store( iv_command = 'RUN_TESTS' iv_json = lv_tests ).
        send( io_manager = i_message_manager iv_text = ls_answer-json ).
    ENDCASE.
  ENDMETHOD.

  METHOD if_apc_wsp_extension~on_close.
    zcl_osd_adt_host=>store( iv_command = 'ACTIVATE'
      iv_type = 'CLAS' iv_name = 'ZCL_APC_STORE_TARGET' ).
  ENDMETHOD.

  METHOD send.
    DATA lo_message TYPE REF TO if_apc_wsp_message.
    lo_message = io_manager->create_message( ).
    lo_message->set_text( iv_text ).
    io_manager->send( lo_message ).
  ENDMETHOD.
ENDCLASS.
