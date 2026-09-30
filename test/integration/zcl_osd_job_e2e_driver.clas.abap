CLASS zcl_osd_job_e2e_driver DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_ranges TYPE RANGE OF string.
    CLASS-METHODS ranges RETURNING VALUE(rt_range) TYPE ty_ranges.
    CLASS-METHODS schedule
      IMPORTING iv_jobname TYPE string iv_jobcount TYPE string
                iv_run TYPE string.
    CLASS-METHODS schedule_supported
      IMPORTING iv_jobname TYPE string iv_jobcount TYPE string
                iv_run TYPE string iv_mode TYPE string.
ENDCLASS.

CLASS zcl_osd_job_e2e_driver IMPLEMENTATION.
  METHOD ranges.
    APPEND VALUE #( sign = 'I' option = 'EQ' low = `a'b` ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'EQ' low = `a\b` ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'NE' low = 'a&b' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'NE' low = '<tag>' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'GT' low = |caf{ cl_abap_conv_in_ce=>uccp( '00E9' ) }| ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'GT' low = `tail  ` ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'GE' low = 'A' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'GE' low = 'B' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'LT' low = 'C' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'LT' low = 'D' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'LE' low = 'E' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'LE' low = 'F' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'BT' low = 'G' high = 'Z' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'BT' low = 'H' high = 'Y' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'NB' low = 'I' high = 'X' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'NB' low = 'J' high = 'W' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'CP' low = 'K*' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'CP' low = 'L*' ) TO rt_range.
    APPEND VALUE #( sign = 'I' option = 'NP' low = 'M*' ) TO rt_range.
    APPEND VALUE #( sign = 'E' option = 'NP' low = 'N*' ) TO rt_range.
  ENDMETHOD.
  METHOD schedule.
    DATA lt_range TYPE ty_ranges.
    lt_range = ranges( ).
    SUBMIT zosd_job_e2e WITH p_run = iv_run WITH s_text IN lt_range
      VIA JOB iv_jobname NUMBER iv_jobcount AND RETURN.
  ENDMETHOD.
  METHOD schedule_supported.
    DATA lt_range TYPE ty_ranges.
    CASE iv_mode.
      WHEN 'I_EQ'.
        APPEND VALUE #( sign = 'I' option = 'EQ' low = 'ALPHA' ) TO lt_range.
      WHEN 'E_EQ'.
        APPEND VALUE #( sign = 'E' option = 'EQ' low = 'BETA' ) TO lt_range.
      WHEN 'I_CP'.
        APPEND VALUE #( sign = 'I' option = 'CP' low = 'A*' ) TO lt_range.
    ENDCASE.
    SUBMIT zosd_job_e2e WITH p_run = iv_run WITH s_text IN lt_range
      VIA JOB iv_jobname NUMBER iv_jobcount AND RETURN.
  ENDMETHOD.
ENDCLASS.
