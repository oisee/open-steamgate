CLASS zcl_osd_t_tick DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_abap_timer_handler.
    CLASS-DATA gv_fired TYPE i.
    CLASS-DATA gv_expect TYPE i.
    CLASS-DATA gv_armed_at TYPE timestampl.
    DATA mv_armed TYPE timestampl.
    METHODS constructor IMPORTING iv_probe TYPE csequence iv_label TYPE csequence.
  PRIVATE SECTION.
    DATA mv_probe TYPE string.
    DATA mv_label TYPE string.
    METHODS log IMPORTING iv_cb TYPE csequence iv_txt TYPE csequence OPTIONAL.
ENDCLASS.



CLASS zcl_osd_t_tick IMPLEMENTATION.

  METHOD constructor.
    mv_probe = iv_probe.
    mv_label = iv_label.
    GET TIME STAMP FIELD mv_armed.
  ENDMETHOD.

  METHOD log.
    DATA ls TYPE zosd_t_dlog.
    TRY.
        ls-logid = cl_system_uuid=>create_uuid_x16_static( ).
      CATCH cx_uuid_error.
    ENDTRY.
    ls-mandt = sy-mandt.
    ls-probe = mv_probe.
    GET TIME STAMP FIELD ls-ts.
    ls-cb = iv_cb.
    ls-uname = sy-uname.
    ls-clnt = sy-mandt.
    ls-txt = iv_txt.
    INSERT zosd_t_dlog CONNECTION r/3*osdlog FROM ls.
    COMMIT CONNECTION r/3*osdlog.
  ENDMETHOD.

  METHOD if_abap_timer_handler~on_timeout.
    DATA lv_now TYPE timestampl.
    DATA lv_s TYPE p LENGTH 16 DECIMALS 7.
    GET TIME STAMP FIELD lv_now.
    IF mv_label = 'many'.
      gv_fired = gv_fired + 1.
      IF gv_fired = gv_expect OR gv_fired MOD 100 = 0.
        lv_s = cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = gv_armed_at ).
        log( iv_cb = 'TMANY_FIRED' iv_txt = |fired={ gv_fired } of { gv_expect } ms_after_arming_done={ CONV decfloat34( lv_s * 1000 ) DECIMALS = 3 }| ).
      ENDIF.
      RETURN.
    ENDIF.
    lv_s = cl_abap_tstmp=>subtract( tstmp1 = lv_now tstmp2 = mv_armed ).
    log( iv_cb = 'TFIRE' iv_txt = |{ mv_label } ms={ CONV decfloat34( lv_s * 1000 ) DECIMALS = 3 }| ).
  ENDMETHOD.

ENDCLASS.
