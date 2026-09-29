CLASS zcl_osd_job_typed_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv_jobcount) TYPE tbtcjob-jobcount.
ENDCLASS.

CLASS zcl_osd_job_typed_probe IMPLEMENTATION.
  METHOD run.
    DATA lv_jobname TYPE tbtcjob-jobname.
    DATA lv_jobcount TYPE tbtcjob-jobcount.
    DATA lv_released TYPE btch0000-char1.
    DATA lv_finished TYPE btch0000-char1.
    lv_jobname = 'TYPED_JOB'.
    CALL FUNCTION 'JOB_OPEN'
      EXPORTING jobname = lv_jobname
      IMPORTING jobcount = lv_jobcount.
    CALL FUNCTION 'JOB_SUBMIT'
      EXPORTING jobname = lv_jobname jobcount = lv_jobcount
                authcknam = sy-uname report = 'ZGG_EX_012'.
    CALL FUNCTION 'JOB_CLOSE'
      EXPORTING jobname = lv_jobname jobcount = lv_jobcount strtimmed = 'X'
      IMPORTING job_was_released = lv_released.
    IF lv_released <> 'X'.
      RETURN.
    ENDIF.
    COMMIT WORK.
    CALL FUNCTION 'SHOW_JOBSTATE'
      EXPORTING jobname = lv_jobname jobcount = lv_jobcount
      IMPORTING finished = lv_finished.
    rv_jobcount = lv_jobcount.
  ENDMETHOD.
ENDCLASS.
