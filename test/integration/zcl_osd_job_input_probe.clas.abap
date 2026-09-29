CLASS zcl_osd_job_input_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS schedule
      IMPORTING iv_jobname TYPE string iv_jobcount TYPE string
                iv_value TYPE string.
ENDCLASS.

CLASS zcl_osd_job_input_probe IMPLEMENTATION.
  METHOD schedule.
    SUBMIT zgg_ex_012 VIA JOB iv_jobname NUMBER iv_jobcount
      WITH p_date = iv_value AND RETURN.
  ENDMETHOD.
ENDCLASS.
