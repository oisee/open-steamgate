REPORT zosd_sub_range.

* The end-to-end check for SUBMIT ... WITH sel IN range: the caller says how
* many of 1 to 10 its range admits, and the report checks it. A range lost
* on the way admits all ten and ends in an error message here, so the
* caller's SUBMIT fails. (MESSAGE, not ASSERT: the report converter has no
* ASSERT and would reduce the report to a skeleton.)
DATA gv_number TYPE i.
SELECT-OPTIONS s_num FOR gv_number.
PARAMETERS p_exp TYPE i.

START-OF-SELECTION.
  DATA lv_hits TYPE i.
  DO 10 TIMES.
    IF sy-index IN s_num.
      lv_hits = lv_hits + 1.
    ENDIF.
  ENDDO.
  WRITE lv_hits.
  IF lv_hits <> p_exp.
    MESSAGE 'The range reached the report changed' TYPE 'E'.
  ENDIF.
