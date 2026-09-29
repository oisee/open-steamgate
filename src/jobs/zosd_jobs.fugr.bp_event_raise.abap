FUNCTION bp_event_raise.
*" IMPORTING EVENTID EVENTPARM
*" EXCEPTIONS BAD_EVENTID EVENTID_DOES_NOT_EXIST EVENTID_MISSING RAISE_FAILED
  DATA lv_name TYPE string.
  DATA lv_error TYPE string.
  lv_name = eventid.
  CONDENSE lv_name.
  TRANSLATE lv_name TO UPPER CASE.
  IF lv_name IS INITIAL.
    RAISE eventid_missing.
  ENDIF.
  IF strlen( lv_name ) > 32.
    RAISE bad_eventid.
  ENDIF.
  IF strlen( eventparm ) > 64.
    RAISE raise_failed.
  ENDIF.
  CALL FUNCTION 'ZOSD_JOB_PORT' DESTINATION 'JOBS'
    EXPORTING iv_command = 'EVENT' iv_jobname = lv_name
              iv_event_param = eventparm iv_owner = sy-uname iv_client = sy-mandt
    IMPORTING ev_error = lv_error.
  IF lv_error IS NOT INITIAL.
    IF lv_error = 'Invalid event ID or parameter'.
      RAISE bad_eventid.
    ENDIF.
    RAISE raise_failed.
  ENDIF.
ENDFUNCTION.
